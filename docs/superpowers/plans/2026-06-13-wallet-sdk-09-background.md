# Wallet SDK — S9: Background (leader election + poll loop + realtime forwarder) + wiring dark executeQuote/receiveToken — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SDK self-driving and make the three dark public entry points real — wire `cashu.send.executeQuote` / `spark.send.executeQuote` / `cashu.receive.receiveToken`, build the realtime DB-event→SDK-event forwarder, build the leader-elected 5s poll loop that drives the S7 orchestrators (cashu reconcile/process + spark reconcile + quote-expiry sweeps), fix the deferred 07a M1 double-emit, and assemble `background.start()/stop()/state()` into `sdk.ts` — all verified by SDK unit tests alone (the web is untouched; `background` is built but NOT started against the live web until S13).

**Architecture:** Slice S9 of the no-cache full migration (spec §9 Phase 1). Unlike S7 (which built the orchestration *primitives* "dark"), S9 is the **wiring slice**: it imports those primitives and makes the public surface live. Three concerns: (1) **foreground writes** — `executeQuote`/`receiveToken` call the per-op services directly so `DomainError`s surface to the UI; (2) **the realtime forwarder** — one private `wallet:<userId>` broadcast channel mapping server-written row changes to `transaction:*` / `account:updated` / `user:updated` SDK events (runs whenever started, regardless of leadership); (3) **the leader-elected task loop** — a single 5s timer that calls `take_lead` and, when leader, runs one reconcile pass over the six work-lists driving the S7 orchestrators + a quote-expiry sweep. `background.start/stop` are auth-lifecycle only (spec D10 — no connectivity seam). The SDK background is **not started against the live web until S13** (avoids dual-ownership of `wallet.task_processing_locks` — spec §8).

**Tech Stack:** TypeScript, `bun test` (+ `bun:test` `mock`), `@cashu/cashu-ts@3.6.1` (`getDecodedToken`, `MeltQuoteState`), `@agicash/breez-sdk-spark`, `@agicash/money`, the SDK's `SdkEventEmitter` + the existing `SupabaseRealtimeManager`. Package manager: `bun`/`bunx` only. CI gate per task: `bun run typecheck` + `bun run test` (NOT `fix:all`).

## Global Constraints

- `SdkError`/`DomainError` take **`(message, code)`**; `NotImplementedError` takes **`(method)`**. Every ported throw needs a `code`. Repo DB errors go through `classify(error)` (`import { classify } from '../classify'`).
- **Never** use bare `mock.module` (process-global; leaked into 100+ sibling tests in S3/S5). Use **DI'd fakes** (every new class takes its deps via a constructor `deps` object) + a **real `SdkEventEmitter`** to assert emissions. `spyOn` + `afterEach/afterAll(() => mock.restore())` only if a real prototype must be redirected. Repos are unit-tested against the `makeFakeDb` mocked Supabase client (S5/S6 pattern).
- Emit SDK events **only on a real state transition** — gate on the returned entity state where the service returns the entity; dedupe repeated event deliveries with a per-call `triggered: Set<string>` for void-returning paths (the 07b pattern; this slice ports it into the one remaining 07a gap).
- Per-task gate: `bun run typecheck` + `bun run test` (run from `packages/wallet-sdk/`). **One git commit per task**, message `feat(wallet-sdk): …`.
- bun/bunx only. Worktree root is the cwd; SDK paths are under `packages/wallet-sdk/`.
- **S9 makes things LIVE but stays unstarted in production:** `executeQuote`/`receiveToken` stop throwing; `background` is constructed in `sdk.ts`; but no code calls `sdk.background.start()` (the web does that in S13). Verified by SDK unit tests alone — the web is untouched.
- `noUnusedLocals` is OFF (`tsc --noEmit` does not flag unused imports) — but do not leave dead code.
- SDK runtime code MAY use `new Date()` / `crypto.randomUUID()` (these are only forbidden inside Workflow scripts, not in the SDK).

---

## Background facts (verified against current code 2026-06-18 — do not re-derive)

### The three dark public stubs S9 makes real
```ts
// domains/cashu/cashu-domain.ts:167  executeQuote() { throw new NotImplementedError('cashu.send.executeQuote'); }
// domains/cashu/cashu-domain.ts:188  receiveToken() { throw new NotImplementedError('cashu.receive.receiveToken'); }
// domains/spark/spark-domain.ts:93    executeQuote() { throw new NotImplementedError('spark.send.executeQuote'); }
```
Contract (`domains.ts`):
```ts
// CashuSendOps:    executeQuote(quote: CashuSendQuote): Promise<CashuSendQuote>;
// SparkSendOps:    executeQuote(quote: SparkSendQuote): Promise<SparkSendQuote>;
// CashuReceiveOps: receiveToken(params: { token: string; destinationAccount?: Account }):
//                    Promise<CashuReceiveQuote | SparkReceiveQuote | CashuReceiveSwap>;
```

### `BackgroundDomain` + `BackgroundState` (`domains.ts:382`, `events.ts:20`)
```ts
export interface BackgroundDomain { start(): Promise<void>; stop(): Promise<void>; state(): BackgroundState; } // state() is SYNC
export type BackgroundState = 'stopped' | 'starting' | 'follower' | 'leader' | 'stopping';
// events.ts:91  'background:state': { state: BackgroundState }
```
`sdk.ts:66-67` declares `readonly background: BackgroundDomain = notImplementedDomain<BackgroundDomain>('background');` (the only class-field-initializer domain). There is **no** `domains/background/` dir and **no** `createBackgroundDomain` yet.

### SDK event payloads the loop/forwarder emit (`events.ts`)
```ts
'send:pending':     { quoteId; transactionId; protocol: 'cashu'|'spark' }
'send:completed':   { quoteId; transactionId; amount: Money; protocol }
'send:failed':      { quoteId; error: SdkError; protocol }            // NO transactionId
'receive:completed':{ quoteId; transactionId; amount: Money; protocol }
'receive:expired':  { quoteId; protocol }
'receive:failed':   { quoteId; error: SdkError; protocol }
'account:updated':  { account: Account; op: 'created' | 'updated' }
'transaction:created': { transaction: Transaction }
'transaction:updated': { transaction: Transaction }
'user:updated':     { user: User }
'background:state': { state: BackgroundState }
// (contact:created/:deleted exist but the forwarder does NOT drive them — see D2)
```
`SdkEventEmitter<M>` (`internal/event-emitter.ts`): `emit(event, data)`, `on(event, handler) => () => void`, `once`, `removeAll()`. Tests construct a real one and `.on(...)`.

### `SdkConfig` + connections (`config.ts`, `internal/connections/index.ts`)
- `config.clientId?: string` — leader-election instance id, "auto-generated if omitted" (the docstring; **no code generates it yet** — S9 does: `config.clientId ?? crypto.randomUUID()`). No poll-interval field, no realtime field, no connectivity field (D10 holds).
- `config.storage: StorageProvider`. `getCurrentUserId(storage): Promise<string|null>` is a free fn (`internal/connections/open-secret.ts:119`).
- `SdkConnections` (already built, on `ctx.connections`): `supabase`, `realtime: SupabaseRealtimeManager` (**built but currently unused**), `encryption`, `cashuWallets: CashuWalletService`, `sparkWallets`, `mintAuth`, `getCashuSeed`, `cashuCrypto`, `cashuMintValidator: ReturnType<typeof buildMintValidator>`.

### DB lock + realtime (`internal/db/database.types.ts`, `internal/realtime/*`)
- `take_lead` RPC: `Args { p_client_id: string; p_user_id: string }` → `boolean`. Lock TTL is **6s** server-side; poll cadence is **5s** (1s slack). `task_processing_locks` keyed by `user_id` (FK → `users.id`).
- `SupabaseRealtimeManager`: `channel(topicName, { private? }): RealtimeChannelBuilder` → `builder.on('broadcast', { event: '*' }, cb)` → `addChannel(builder): SupabaseRealtimeChannel` → `subscribe(channelTopic, onConnected?)` / `removeChannel(channelTopic, { onConnected? })`. Builder `get topic` returns `` `realtime:${topicName}` ``. The broadcast callback receives `{ type: 'broadcast'; event: string; payload: <row jsonb>; meta? }`.
- DB triggers broadcast on the single private topic `wallet:<userId>`: `TRANSACTION_CREATED/UPDATED` (payload = the row; UPDATE adds `previous_acknowledgment_status`), `ACCOUNT_CREATED/UPDATED` (payload = `to_account_with_proofs(new)`), `USER_UPDATED` (topic `wallet:<new.id>`, UPDATE-only), `CONTACT_CREATED/DELETED`, plus `CASHU_*`/`SPARK_*` quote/swap events.

### Row→entity mappers the forwarder calls (no re-read needed — payload IS the full row)
- `transactionRepo.toTransaction(data: TransactionRow): Promise<Transaction>` (`transaction-repository.ts:111`) — decrypts + parses; `version` from `data.version`.
- `accountRepository.toAccount(data: AgicashDbAccountWithProofs): Promise<Account>` (`account-repository.ts:119`) — accepts the `to_account_with_proofs` broadcast payload shape; builds the live wallet + `isOnline`.
- `toUser(dbUser: AgicashDbUser): User` — free fn at `internal/db/user-mapper.ts:9`.

### `AccountRepository` — the account-build seam (`internal/repositories/account-repository.ts`)
- `get(id, options?): Promise<Account | null>` — builds the live account (cashu wallet-init / spark connect); offline spark = a non-null `Account` whose `wallet` is a throwing Proxy stub and `isOnline: false`.
- `getAllActive(userId, options?): Promise<Account[]>` — all active accounts, built.

### S7 orchestrators (dark — S9 imports them by direct path; `internal/orchestrator/` has NO barrel)
Each takes a constructor `deps` object with `getAccount: (id) => Promise<CashuAccount|null>` (or `SparkAccount|null`), the relevant subscription manager(s), and `emitter`. Per-tick entry points + return types (verified):
- `CashuSendOrchestrator({ sendQuoteService, sendQuoteRepository, getAccount, meltSubscriptionManager, emitter })`: `reconcile(quotes: CashuSendQuote[]): Promise<void>` (manager-owned subs, idempotent), `applyMeltQuoteState(account, quote, meltQuote)`. nutshell-#788 lives in its `resolvePaidMeltQuote`.
- `CashuSendSwapOrchestrator({ sendSwapService, getAccount, proofStateSubscriptionManager, emitter })`: `processDrafts(swaps: CashuSendSwap[]): Promise<void>`, `reconcile(pending: PendingCashuSendSwap[]): Promise<void>`, `applyProofSpent(swap)`.
- `CashuReceiveQuoteOrchestrator({ receiveQuoteService, getAccount, mintSubscriptionManager, meltSubscriptionManager, emitter })`: `reconcileMintQuotes(quotes): Promise<void>`, `reconcileCrossMintMelts(tokenQuotes, { initiateMelt }): Promise<void>`, `applyMintQuoteState`, `applyCrossMintMeltState`. **M1 double-emit is here** (Task 1).
- `CashuReceiveSwapOrchestrator({ receiveSwapService, getAccount, emitter })`: `processPending(swaps: CashuReceiveSwap[]): Promise<void>`.
- `SparkSendOrchestrator({ sendQuoteService, getAccount, emitter })`: `reconcile(sendQuotes): Promise<() => void>` (caller-owned cleanup thunk), `initiateSend(account, quote)`, `applyPaymentEvent(...)`.
- `SparkReceiveOrchestrator({ receiveQuoteService, getAccount, meltSubscriptionManager, emitter })`: `reconcile(receiveQuotes): Promise<() => void>`, `reconcileCrossMintMelts(receiveQuotes, { initiateMelt }): Promise<void>`, `applyExpiry(quote): Promise<void>`, `applyPaymentSucceeded`.
- `SparkBalanceListener({ emitter })`: `register(account: SparkAccount): Promise<() => void>`.

### The six per-tick work-list reads (all exist on the repos; `(userId, options?) => Promise<T[]>`)
| Repo | method | state filter |
|---|---|---|
| `CashuSendQuoteRepository` | `getUnresolved` | `['UNPAID','PENDING']` |
| `CashuSendSwapRepository` | `getUnresolved` | `['DRAFT','PENDING']` |
| `CashuReceiveQuoteRepository` | `getPending` | `['UNPAID','PAID']` |
| `CashuReceiveSwapRepository` | `getPending` | `'PENDING'` |
| `SparkSendQuoteRepository` | `getUnresolved` | `['UNPAID','PENDING']` |
| `SparkReceiveQuoteRepository` | `getPending` | `'UNPAID'` |

### Service signatures the wiring calls (verified)
- `CashuSendQuoteService.initiateSend(account, sendQuote, meltQuote: Pick<MeltQuoteBolt11Response,'quote'|'amount'>)` (does the melt; throws `DomainError`/`MintOperationError`; no DB write); `.markSendQuoteAsPending(quote): Promise<CashuSendQuote>` (UNPAID→PENDING); `.expireSendQuote(quote): Promise<void>`; `.failSendQuote(account, quote, reason): Promise<CashuSendQuote>`.
- `SparkSendQuoteService.initiateSend({ account, sendQuote }): Promise<SparkSendQuote>` (returns the PENDING quote; throws `DomainError` `'fee_changed'`/`'invalid_state'`).
- `CashuReceiveQuoteService.expire(quote): Promise<void>` (UNPAID→EXPIRED; throws if not UNPAID / not yet expired).
- `ClaimCashuTokenService.claimToken({ userId, token, sourceAccount: CashuAccount, destinationAccount: Account }): Promise<CashuReceiveQuote | SparkReceiveQuote | CashuReceiveSwap>` (`internal/orchestrator/claim-cashu-token-service.ts`). Deps `{ receiveSwapService, receiveCashuTokenQuoteService, getRate: (ticker: string) => Promise<string> }`.
- `ReceiveCashuTokenQuoteService` ctor (positional): `(cashuReceiveQuoteService, sparkReceiveQuoteService, getSparkLightningQuote?)`.
- `ReceiveCashuTokenService` ctor (positional): `(cashuWallets: CashuWalletService, cashuMintValidator)`; `buildAccountForMint(mintUrl, currency): Promise<CashuAccountWithTokenFlags>`; `getSourceAndDestinationAccounts(token, accounts?)`.
- `ExchangeRateDomain.getRate(ticker: Ticker): Promise<string>` (`Ticker = \`${string}-${string}\``).
- Token decode: cashu-ts `getDecodedToken(encoded: string): Token` (no SDK wrapper). `tokenToMoney(token): Money`, `areMintUrlsEqual(a, b)`, `toProof` from `internal/lib/cashu`.

### Domain factory + sdk assembly (`sdk.ts`, `domains/context.ts`)
- `DomainContext = { config: SdkConfig; connections: SdkConnections; emitter: SdkEventEmitter<SdkEventMap> }`.
- `createCashuDomain(ctx, accountRepository)` (already takes both); `createSparkDomain(ctx)` (**only ctx today** — S9 adds `accountRepository`). Both build their repos+services privately; `requireUserId` helper resolves `getCurrentUserId(ctx.config.storage)` → `SdkError('No active session','NOT_AUTHENTICATED')` on null. Cashu factory has `requireCashuAccount(id): Promise<CashuAccount>` + `exchangeRate = createExchangeRateDomain()`.
- `sdk.ts` ctor builds `const accountRepository = new AccountRepository(connections.supabase, connections.encryption, connections.cashuWallets, connections.sparkWallets, connections.mintAuth, connections.getCashuSeed);` and assigns each domain. `createSparkDomain(ctx)` is at `sdk.ts:93`.

---

## Decisions (forks resolved before writing — carry, do NOT re-litigate)

- **D1 — `executeQuote` is the foreground kick that surfaces `DomainError`s; the background loop completes it.** It calls the per-op **service** directly (not the orchestrator, which swallows `DomainError` by failing the quote). cashu: `checkMeltQuoteBolt11` → `initiateSend` → `markSendQuoteAsPending` → emit `send:pending` → return PENDING quote. spark: `initiateSend({account, sendQuote})` (already returns PENDING) → emit `send:pending`. A thrown `DomainError`/`MintOperationError` propagates to the caller (UI). Double-initiate vs the loop is guarded by `meltProofsIdempotent` + the service state-guards (already PENDING → no-op).
- **D2 — The realtime forwarder drives ONLY `transaction:created`/`:updated`, `account:updated`, `user:updated`. It SKIPS contacts.** Rationale: contacts are written by the SDK's own `add`/`remove`, which already emit `contact:created`/`:deleted` synchronously (S8 D5); the consumer cache is a naive append with no `version` to dedupe, so forwarding `CONTACT_CREATED`/`DELETED` on the originating client double-drives. Transactions are `version`-gated and user/account are replace/version-aware, so forwarding them despite any synchronous emit is idempotent. Cross-device contact sync degrades to the web's kept `refetchOnReconnect`/`refetchOnWindowFocus` (S13). The quote/swap `CASHU_*`/`SPARK_*` broadcasts are NOT forwarded (no SDK-event analog; the orchestrators emit `send:*`/`receive:*` on the leader).
- **D3 — The forwarder maps the broadcast payload directly (no re-read).** `payload` IS the full row, so `transactionRepo.toTransaction(payload)` / `accountRepository.toAccount(payload)` / `toUser(payload)`. `account:updated` `op` = `'created'` for `ACCOUNT_CREATED`, `'updated'` for `ACCOUNT_UPDATED`.
- **D4 — The forwarder runs whenever started (NOT leader-gated); the task loop runs only when leader.** Mirrors the web (`useTrackWalletChanges` is unconditional; `TaskProcessor` is `isLead`-gated). `SparkBalanceListener`s are also always-on (spark balance comes only from `getInfo`, never the DB, so every client needs its own).
- **D5 — One 5s timer.** Each tick: `take_lead(userId, clientId)`; if `true` → state `leader` + run one `TaskLoop.runOnce()`; if `false` → state `follower` + dispose the spark cleanup thunks. The leader poll IS the cadence (matching the web's `refetchInterval: 5000`); there is no second timer. `take_lead` failures are logged and retried next tick — this also absorbs the user-row bootstrap race (the lock FK references `users.id`; a brand-new signup's `take_lead` fails until the row exists, then succeeds on a later tick — no explicit bootstrap retry needed; resolves the Plan-03 carryover).
- **D6 — `getAccount` online-filtering closes the offline-spark hazard + the online filter in one helper.** The loop passes the orchestrators `getCashuAccount`/`getSparkAccount` that return `null` for an account that is missing, the wrong type, OR `!isOnline`. Offline spark accounts (whose stub `wallet.addEventListener` throws) are thus skipped by the orchestrators' existing `if (!account) continue` guards. No orchestrator changes needed.
- **D7 — Cleanup-thunk lifecycle is split by protocol (verified asymmetry).** Cashu `reconcile*` return `void`; their WS subscriptions are manager-owned, deduped via `isSubset`, and self-clean on socket close — the orchestrators discard the thunk. So the cashu managers + orchestrators are built ONCE (persist across start/stop) and `stop()` does NOT proactively close cashu WS (they idle + are reused on the next start; a documented, acceptable limitation of the manager API). Spark `reconcile`/`register` return `() => void` thunks; the `TaskLoop` tracks the prior tick's spark thunks and disposes them before re-reconciling and on `stop()`. `reconcileCrossMintMelts` (both protocols) discards its melt-sub thunk (same manager-self-clean model as cashu).
- **D8 — Quote expiry is loop-driven for cashu** (the orchestrators have no expiry path). The `TaskLoop` sweeps: cashu send UNPAID+expired → `expireSendQuote` (no event — there is no `send:expired`); cashu receive UNPAID+expired → `receive.expire` + emit `receive:expired` (gate: `expire` throws if not UNPAID, so a race produces no emit); spark receive → `sparkReceive.applyExpiry(q)` (the orchestrator guards UNPAID+expired and emits internally). Single-emit is guaranteed because an expired quote drops out of the next tick's work-list.
- **D9 — The M1 double-emit is fixed cashu-side only** (spark was fixed in 07b D4). Add a per-call `triggered: Set<string>` keyed `${quote.id}:${meltQuote.state}` to `CashuReceiveQuoteOrchestrator.reconcileCrossMintMelts`'s `onUpdate` routing, collapsing repeated source-melt `UNPAID` deliveries within one subscription window to one `receive:failed` emit.
- **D10 — `createBackgroundDomain(ctx, accountRepository)` builds its own orchestration bundle** (6 repos + 6 services + 5 WS managers + 6 orchestrators + `SparkBalanceListener` + the shared `initiateMelt`/`getAccount`/`getCashuWalletForMint` helpers) from `ctx.connections` + `accountRepository`, mirroring S8 D2 (consumers rebuild from connections rather than a cross-domain hoist). `createCashuDomain` separately rebuilds a `SparkReceiveQuoteService` for `receiveToken` (a ~2-line dup, same precedent). The orchestrators are used ONLY by the loop; `executeQuote` uses the services directly (D1).

---

## File Structure

```
packages/wallet-sdk/src/
  internal/orchestrator/
    cashu-receive-quote-orchestrator.ts        (Task 1, MODIFY — M1 triggered-Set fix)
    cashu-receive-quote-orchestrator.test.ts   (Task 1, MODIFY — regression)
  internal/background/
    task-processing-lock-repository.ts          (Task 2, new)  — take_lead RPC
    task-processing-lock-repository.test.ts     (Task 2, new)
    task-loop.ts                                (Tasks 7–8, new) — TaskLoop.runOnce + expiry sweep
    task-loop.test.ts                           (Tasks 7–8, new)
    background-runner.ts                        (Task 9, new)  — leader poll + lifecycle + balance listeners
    background-runner.test.ts                   (Task 9, new)
  internal/realtime/
    wallet-changes-forwarder.ts                 (Task 6, new)  — broadcast → SDK events
    wallet-changes-forwarder.test.ts            (Task 6, new)
  domains/cashu/cashu-domain.ts                 (Tasks 3, 5, MODIFY — executeQuote + receiveToken)
  domains/cashu/cashu-domain.test.ts            (Tasks 3, 5, MODIFY)
  domains/spark/spark-domain.ts                 (Task 4, MODIFY — executeQuote + accountRepository param)
  domains/spark/spark-domain.test.ts            (Task 4, MODIFY)
  domains/background/background-domain.ts       (Task 10, new) — createBackgroundDomain (wires the bundle)
  domains/background/background-domain.test.ts  (Task 10, new)
  sdk.ts                                        (Tasks 4, 11, MODIFY — createSparkDomain arg + background ctor)
  sdk.test.ts                                   (Task 11, MODIFY)
```

---

## Task 1: Fix the deferred 07a M1 double-emit (cashu cross-mint `receive:failed`)

**Files:**
- Modify: `packages/wallet-sdk/src/internal/orchestrator/cashu-receive-quote-orchestrator.ts`
- Modify: `packages/wallet-sdk/src/internal/orchestrator/cashu-receive-quote-orchestrator.test.ts`

**Interfaces:**
- Consumes / Produces: no signature change. `reconcileCrossMintMelts(quotes, { initiateMelt })` gains an internal per-call `triggered: Set<string>` that dedupes repeated melt-quote deliveries before routing into `applyCrossMintMeltState` (which emits `receive:failed` unconditionally after the void `fail()`).

- [ ] **Step 1: Write the failing regression test** — append to `cashu-receive-quote-orchestrator.test.ts`. (Reuse the file's existing fakes; this block is self-contained otherwise.)

```ts
import { MeltQuoteState } from '@cashu/cashu-ts';

describe('CashuReceiveQuoteOrchestrator M1 dedupe (repeated source-melt UNPAID)', () => {
  it('emits receive:failed exactly once when the melt WS delivers UNPAID twice for an already-initiated quote', async () => {
    const emitter = new SdkEventEmitter<SdkEventMap>();
    const failedEvents: unknown[] = [];
    emitter.on('receive:failed', (e) => failedEvents.push(e));

    const receiveQuoteService = {
      fail: mock(async () => {}), // void; no-op when already FAILED
    } as unknown as CashuReceiveQuoteService;

    let onUpdate: ((meltQuote: { quote: string; state: MeltQuoteState; amount: number }) => void) | undefined;
    const meltSubscriptionManager = {
      subscribe: mock(async (p: { onUpdate: (q: { quote: string; state: MeltQuoteState; amount: number }) => void }) => {
        onUpdate = p.onUpdate;
        return () => {};
      }),
    } as never;

    const orchestrator = new CashuReceiveQuoteOrchestrator({
      receiveQuoteService,
      getAccount: mock(async () => ({ id: 'acc-1', type: 'cashu', mintUrl: 'https://mint.test' }) as never),
      mintSubscriptionManager: {} as never,
      meltSubscriptionManager,
      emitter,
    });

    const quote = {
      id: 'rq-1', type: 'CASHU_TOKEN', state: 'UNPAID',
      tokenReceiveData: { sourceMintUrl: 'https://mint.test', meltQuoteId: 'mq-1', meltInitiated: true },
    } as never;

    await orchestrator.reconcileCrossMintMelts([quote], { initiateMelt: mock(async () => {}) });
    onUpdate?.({ quote: 'mq-1', state: MeltQuoteState.UNPAID, amount: 40 });
    onUpdate?.({ quote: 'mq-1', state: MeltQuoteState.UNPAID, amount: 40 }); // duplicate delivery
    await new Promise((r) => setTimeout(r, 0));

    expect(receiveQuoteService.fail).toHaveBeenCalledTimes(1);
    expect(failedEvents).toHaveLength(1); // M1: was 2 before the fix
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/orchestrator/cashu-receive-quote-orchestrator.test.ts -t "M1 dedupe"`. Expected: FAIL (`receive:failed` emitted twice / `fail` called twice).

- [ ] **Step 3: Implement the dedupe** — in `cashu-receive-quote-orchestrator.ts`, change `reconcileCrossMintMelts` to add a `triggered` set and gate the `onUpdate` routing (mirrors 07b's spark `reconcileCrossMintMelts`):

```ts
  async reconcileCrossMintMelts(
    quotes: (CashuReceiveQuote & { type: 'CASHU_TOKEN' })[],
    handlers: { initiateMelt: (quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' }) => Promise<void> },
  ): Promise<void> {
    if (quotes.length === 0) return;
    const triggered = new Set<string>();
    const byMeltQuoteId = new Map<string, CashuReceiveQuote & { type: 'CASHU_TOKEN' }>();
    const idsByMint = new Map<string, string[]>();
    for (const quote of quotes) {
      const mintUrl = quote.tokenReceiveData.sourceMintUrl;
      const meltQuoteId = quote.tokenReceiveData.meltQuoteId;
      byMeltQuoteId.set(meltQuoteId, quote);
      const list = idsByMint.get(mintUrl) ?? [];
      list.push(meltQuoteId);
      idsByMint.set(mintUrl, list);
    }
    for (const [mintUrl, quoteIds] of idsByMint) {
      await this.deps.meltSubscriptionManager.subscribe({
        mintUrl,
        quoteIds,
        onUpdate: (meltQuote) => {
          const quote = byMeltQuoteId.get(meltQuote.quote);
          if (!quote) return;
          const key = `${quote.id}:${meltQuote.state}`;
          if (triggered.has(key)) return;
          triggered.add(key);
          void this.applyCrossMintMeltState(quote, meltQuote, handlers).catch((error) =>
            console.error('cashu receive cross-mint melt update failed', {
              quoteId: quote.id,
              cause: error,
            }),
          );
        },
      });
    }
  }
```

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/orchestrator/cashu-receive-quote-orchestrator.test.ts`. Expected: all prior tests + the new regression pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/orchestrator/cashu-receive-quote-orchestrator.ts src/internal/orchestrator/cashu-receive-quote-orchestrator.test.ts
git commit -m "fix(wallet-sdk): dedupe cashu cross-mint receive:failed (deferred 07a M1 double-emit)"
```

---

## Task 2: `TaskProcessingLockRepository.takeLead`

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/task-processing-lock-repository.ts`
- Create: `packages/wallet-sdk/src/internal/background/task-processing-lock-repository.test.ts`

**Interfaces:**
- Produces: `class TaskProcessingLockRepository` with `constructor(db: SupabaseClient<Database>)` and `takeLead(userId: string, clientId: string, options?: { abortSignal?: AbortSignal }): Promise<boolean>` — calls the `take_lead` RPC and returns the boolean (true = this client holds the lead).

- [ ] **Step 1: Write the failing test** — `task-processing-lock-repository.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { makeFakeDb } from '../test-support';
import { TaskProcessingLockRepository } from './task-processing-lock-repository';

describe('TaskProcessingLockRepository', () => {
  it('calls the take_lead RPC with p_user_id/p_client_id and returns the boolean', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const db = makeFakeDb({ rpcResult: { data: true, error: null }, calls });
    const repo = new TaskProcessingLockRepository(db);
    const result = await repo.takeLead('user-1', 'client-1');
    expect(result).toBe(true);
    expect(calls).toContainEqual({ name: 'rpc', args: ['take_lead', { p_user_id: 'user-1', p_client_id: 'client-1' }] });
  });

  it('returns false when the RPC returns null/false', async () => {
    const db = makeFakeDb({ rpcResult: { data: false, error: null } });
    const repo = new TaskProcessingLockRepository(db);
    expect(await repo.takeLead('user-1', 'client-1')).toBe(false);
  });

  it('throws (via classify) when the RPC errors', async () => {
    const db = makeFakeDb({ rpcResult: { data: null, error: { message: 'boom', code: 'XX000' } } });
    const repo = new TaskProcessingLockRepository(db);
    await expect(repo.takeLead('user-1', 'client-1')).rejects.toBeDefined();
  });
});
```

> Verify `makeFakeDb`'s `rpc(name, args)` records into `calls` as `{ name: 'rpc', args: [name, args] }` and resolves to `rpcResult` (`internal/test-support.ts`). If the recorded shape differs, adjust the assertion to match the harness — do not change the harness.

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/background/task-processing-lock-repository.test.ts`. Expected: FAIL (`Cannot find module './task-processing-lock-repository'`).

- [ ] **Step 3: Implement** — `task-processing-lock-repository.ts`

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { classify } from '../classify';
import type { Database } from '../db/database';

type Options = { abortSignal?: AbortSignal };

/** Leader election over `wallet.task_processing_locks` via the `take_lead` RPC (one lock per user; 6s server TTL). */
export class TaskProcessingLockRepository {
  constructor(private readonly db: SupabaseClient<Database>) {}

  /** Attempt to take or refresh the per-user processing lead. Returns true when this client holds it. */
  async takeLead(
    userId: string,
    clientId: string,
    options?: Options,
  ): Promise<boolean> {
    const query = this.db.rpc('take_lead', {
      p_user_id: userId,
      p_client_id: clientId,
    });
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data, error } = await query;
    if (error) throw classify(error);
    return data ?? false;
  }
}
```

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/background/task-processing-lock-repository.test.ts`. Expected: 3 pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/background/task-processing-lock-repository.ts src/internal/background/task-processing-lock-repository.test.ts
git commit -m "feat(wallet-sdk): task-processing lock repository (take_lead leader election)"
```

---

## Task 3: Wire `cashu.send.executeQuote` (foreground kick)

**Files:**
- Modify: `packages/wallet-sdk/src/domains/cashu/cashu-domain.ts`
- Modify: `packages/wallet-sdk/src/domains/cashu/cashu-domain.test.ts`

**Interfaces:**
- Produces: `cashu.send.executeQuote(quote: CashuSendQuote): Promise<CashuSendQuote>` — resolves the account, fetches the live melt quote, calls `initiateSend` then `markSendQuoteAsPending`, emits `send:pending`, returns the PENDING quote. `DomainError`/`MintOperationError` propagate to the caller.

- [ ] **Step 1: Write the failing test** — append to `cashu-domain.test.ts` (follow the file's existing harness for building a `createCashuDomain` with DI'd fakes; the snippet shows the assertions, adapt construction to the file's helpers).

```ts
describe('cashu.send.executeQuote', () => {
  it('initiates the send and marks it pending, emitting send:pending', async () => {
    // Arrange: a fake CashuAccount whose wallet.checkMeltQuoteBolt11 returns a melt quote,
    // a sendQuoteService whose initiateSend resolves and markSendQuoteAsPending returns PENDING,
    // accountRepository.get → the account. Use the file's existing setup helper.
    const { domain, sendQuoteService, emitter } = setupCashuDomainForExecute({
      account: cashuAccount({ checkMeltQuoteBolt11: async () => ({ quote: 'mq-1', amount: 100 }) }),
      markPendingResult: { id: 'sq-1', state: 'PENDING', transactionId: 'tx-1' },
    });
    const pending: unknown[] = [];
    emitter.on('send:pending', (e) => pending.push(e));

    const quote = { id: 'sq-1', state: 'UNPAID', accountId: 'acc-1', quoteId: 'mq-1' } as unknown as CashuSendQuote;
    const result = await domain.send.executeQuote(quote);

    expect(sendQuoteService.initiateSend).toHaveBeenCalledTimes(1);
    expect(sendQuoteService.markSendQuoteAsPending).toHaveBeenCalledTimes(1);
    expect(result.state).toBe('PENDING');
    expect(pending).toEqual([{ quoteId: 'sq-1', transactionId: 'tx-1', protocol: 'cashu' }] as never);
  });

  it('propagates a DomainError from initiateSend (foreground surfaces fee/balance errors)', async () => {
    const { domain } = setupCashuDomainForExecute({
      account: cashuAccount({ checkMeltQuoteBolt11: async () => ({ quote: 'mq-1', amount: 100 }) }),
      initiateSend: async () => { throw new DomainError('Insufficient balance', 'insufficient_balance'); },
    });
    const quote = { id: 'sq-1', state: 'UNPAID', accountId: 'acc-1', quoteId: 'mq-1' } as unknown as CashuSendQuote;
    await expect(domain.send.executeQuote(quote)).rejects.toMatchObject({ code: 'insufficient_balance' });
  });
});
```

> `setupCashuDomainForExecute`/`cashuAccount` are test helpers to add following the existing `cashu-domain.test.ts` conventions (DI'd fakes + a real `SdkEventEmitter` from `ctx.emitter`; `accountRepository.get` returns the fake account; `requireCashuAccount` resolves through it). Reuse the file's existing partial-`ctx` construction. Confirm `CashuSendQuote` carries `quoteId` (the melt quote id) — it is used as the `checkMeltQuoteBolt11` arg and the `initiateSend` melt-quote `quote` field.

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/domains/cashu/cashu-domain.test.ts -t "executeQuote"`. Expected: FAIL (`NotImplementedError: cashu.send.executeQuote is not implemented`).

- [ ] **Step 3: Implement** — in `cashu-domain.ts`, replace the `executeQuote` stub (`:167`). It needs `requireCashuAccount` (already in scope) and `sendQuoteService` (already in scope):

```ts
      async executeQuote(quote: CashuSendQuote): Promise<CashuSendQuote> {
        const account = await requireCashuAccount(quote.accountId);
        const meltQuote = await account.wallet.checkMeltQuoteBolt11(quote.quoteId);
        await sendQuoteService.initiateSend(account, quote, meltQuote);
        const updated = await sendQuoteService.markSendQuoteAsPending(quote);
        if (updated.state === 'PENDING') {
          ctx.emitter.emit('send:pending', {
            quoteId: updated.id,
            transactionId: updated.transactionId,
            protocol: 'cashu',
          });
        }
        return updated;
      },
```

> `initiateSend` throws `DomainError` (state/account/quote mismatch) or `MintOperationError` (mint failure) — both propagate to the caller, which is the intended foreground behaviour (the background loop will fail the quote + emit `send:failed` if the user does not retry). `checkMeltQuoteBolt11` returns a full `MeltQuoteBolt11Response`, which satisfies `initiateSend`'s `Pick<…,'quote'|'amount'>`.

- [ ] **Step 4: Run it; expect PASS** — `bun test src/domains/cashu/cashu-domain.test.ts`. Expected: all pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/domains/cashu/cashu-domain.ts src/domains/cashu/cashu-domain.test.ts
git commit -m "feat(wallet-sdk): wire cashu.send.executeQuote (foreground initiate + mark pending)"
```

---

## Task 4: Wire `spark.send.executeQuote` + add `accountRepository` to `createSparkDomain`

**Files:**
- Modify: `packages/wallet-sdk/src/domains/spark/spark-domain.ts`
- Modify: `packages/wallet-sdk/src/domains/spark/spark-domain.test.ts`
- Modify: `packages/wallet-sdk/src/sdk.ts` (the `createSparkDomain(ctx)` call site)

**Interfaces:**
- Consumes: `SparkSendQuoteService.initiateSend({ account, sendQuote }): Promise<SparkSendQuote>`; `AccountRepository.get(id)`.
- Produces: `createSparkDomain(ctx: DomainContext, accountRepository: AccountRepository): SparkDomain`; `spark.send.executeQuote(quote: SparkSendQuote): Promise<SparkSendQuote>`.

- [ ] **Step 1: Write the failing test** — update `spark-domain.test.ts` (every `createSparkDomain(ctx)` call gains an `accountRepository` arg — a DI'd fake whose `get` returns the spark account), then add:

```ts
describe('spark.send.executeQuote', () => {
  it('initiates the send (returns PENDING) and emits send:pending', async () => {
    const { domain, sendQuoteService, emitter } = setupSparkDomain({
      account: sparkAccount(),
      initiateSendResult: { id: 'sq-1', state: 'PENDING', transactionId: 'tx-1' },
    });
    const pending: unknown[] = [];
    emitter.on('send:pending', (e) => pending.push(e));

    const quote = { id: 'sq-1', state: 'UNPAID', accountId: 'acc-1', transactionId: 'tx-1' } as unknown as SparkSendQuote;
    const result = await domain.send.executeQuote(quote);

    expect(sendQuoteService.initiateSend).toHaveBeenCalledWith({ account: expect.objectContaining({ id: 'acc-1' }), sendQuote: quote });
    expect(result.state).toBe('PENDING');
    expect(pending).toEqual([{ quoteId: 'sq-1', transactionId: 'tx-1', protocol: 'spark' }] as never);
  });

  it('propagates a DomainError from initiateSend (fee_changed surfaces to the UI)', async () => {
    const { domain } = setupSparkDomain({
      account: sparkAccount(),
      initiateSend: async () => { throw new DomainError('Lightning network fee has changed', 'fee_changed'); },
    });
    const quote = { id: 'sq-1', state: 'UNPAID', accountId: 'acc-1' } as unknown as SparkSendQuote;
    await expect(domain.send.executeQuote(quote)).rejects.toMatchObject({ code: 'fee_changed' });
  });
});
```

> `setupSparkDomain`/`sparkAccount` follow the existing `spark-domain.test.ts` conventions; the fake `accountRepository.get` returns the spark account. Add a `requireSparkAccount(id)` helper in `spark-domain.ts` mirroring cashu's `requireCashuAccount` (resolve `accountRepository.get(id)`, throw `DomainError('Account not found','account_not_found')` if null, `DomainError('Account is not a spark account','invalid_account_type')` if `type !== 'spark'`).

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/domains/spark/spark-domain.test.ts`. Expected: FAIL (type error on the new `accountRepository` param and/or `NotImplementedError`).

- [ ] **Step 3a: Implement the signature change** — in `spark-domain.ts`, change the factory signature and add the account resolver:

```ts
import type { AccountRepository } from '../../internal/repositories/account-repository';
import type { SparkAccount } from '../../types/account';
// ...
export function createSparkDomain(
  ctx: DomainContext,
  accountRepository: AccountRepository,
): SparkDomain {
  // ... existing repo/service construction ...

  const requireSparkAccount = async (id: string): Promise<SparkAccount> => {
    const account = await accountRepository.get(id);
    if (!account) throw new DomainError('Account not found', 'account_not_found');
    if (account.type !== 'spark') {
      throw new DomainError('Account is not a spark account', 'invalid_account_type');
    }
    return account;
  };
```

- [ ] **Step 3b: Implement `executeQuote`** — replace the stub (`:93`):

```ts
      async executeQuote(quote: SparkSendQuote): Promise<SparkSendQuote> {
        const account = await requireSparkAccount(quote.accountId);
        const updated = await sendQuoteService.initiateSend({ account, sendQuote: quote });
        if (updated.state === 'PENDING') {
          ctx.emitter.emit('send:pending', {
            quoteId: updated.id,
            transactionId: updated.transactionId,
            protocol: 'spark',
          });
        }
        return updated;
      },
```

- [ ] **Step 3c: Update the call site** — in `sdk.ts:93`, change `this.spark = createSparkDomain(ctx);` to `this.spark = createSparkDomain(ctx, accountRepository);` (the `accountRepository` const already exists earlier in the ctor).

- [ ] **Step 4: Run it; expect PASS** — `bun test src/domains/spark/spark-domain.test.ts && bun test src/sdk.test.ts`. Expected: all pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/domains/spark/spark-domain.ts src/domains/spark/spark-domain.test.ts src/sdk.ts
git commit -m "feat(wallet-sdk): wire spark.send.executeQuote (+ accountRepository into createSparkDomain)"
```

---

## Task 5: Wire `cashu.receive.receiveToken` (decode + source/dest resolution + claim)

**Files:**
- Modify: `packages/wallet-sdk/src/domains/cashu/cashu-domain.ts`
- Modify: `packages/wallet-sdk/src/domains/cashu/cashu-domain.test.ts`

**Interfaces:**
- Consumes: cashu-ts `getDecodedToken`; `ReceiveCashuTokenService.buildAccountForMint`; `ClaimCashuTokenService.claimToken`; `ReceiveCashuTokenQuoteService`; `ExchangeRateDomain.getRate`.
- Produces: `cashu.receive.receiveToken(params: { token: string; destinationAccount?: Account }): Promise<CashuReceiveQuote | SparkReceiveQuote | CashuReceiveSwap>`.

- [ ] **Step 1: Write the failing test** — append to `cashu-domain.test.ts`:

```ts
describe('cashu.receive.receiveToken', () => {
  it('decodes the token, resolves the source mint account, and delegates to claimToken (same-mint → swap)', async () => {
    const swap = { tokenHash: 'h', state: 'PENDING' };
    const { domain, claimToken } = setupCashuDomainForReceiveToken({
      decoded: { mint: 'https://mint.a', unit: 'sat', proofs: [{ amount: 10 }] },
      sourceAccount: cashuAccount({ id: 'acc-a', mintUrl: 'https://mint.a' }),
      claimResult: swap,
    });
    const result = await domain.receive.receiveToken({ token: 'cashuAbc...' });
    expect(claimToken).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      sourceAccount: expect.objectContaining({ id: 'acc-a' }),
      destinationAccount: expect.objectContaining({ id: 'acc-a' }), // defaults to source when omitted
    }));
    expect(result as unknown).toBe(swap);
  });

  it('uses the provided destinationAccount for a cross-account claim', async () => {
    const quote = { id: 'dest-rq' };
    const dest = { id: 'spark-1', type: 'spark', currency: 'BTC' } as unknown as Account;
    const { domain, claimToken } = setupCashuDomainForReceiveToken({
      decoded: { mint: 'https://mint.a', unit: 'sat', proofs: [{ amount: 10 }] },
      sourceAccount: cashuAccount({ id: 'acc-a', mintUrl: 'https://mint.a' }),
      claimResult: quote,
    });
    const result = await domain.receive.receiveToken({ token: 'cashuAbc...', destinationAccount: dest });
    expect(claimToken).toHaveBeenCalledWith(expect.objectContaining({ destinationAccount: dest }));
    expect(result as unknown).toBe(quote);
  });
});
```

> `setupCashuDomainForReceiveToken` stubs `getDecodedToken` (spy on the cashu-ts module import via the established `spyOn` + `afterAll(() => mock.restore())` pattern, OR inject a decode fn — prefer a small injected `decodeToken` seam to avoid `mock.module`; see Step 3 note), the `ReceiveCashuTokenService` (its `buildAccountForMint`/`getSourceAndDestinationAccounts` returns the source account), and `ClaimCashuTokenService.claimToken` (the spy). `userId` resolves via the file's `requireUserId` fake.

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/domains/cashu/cashu-domain.test.ts -t "receiveToken"`. Expected: FAIL (`NotImplementedError`).

- [ ] **Step 3a: Build the token-claim collaborators inside `createCashuDomain`** — add to the factory body (after the existing service construction). The cashu factory already destructures `{ supabase, encryption, cashuCrypto }`; also pull `cashuWallets` + `cashuMintValidator` from `ctx.connections`, and build a `SparkReceiveQuoteService` (the cross-domain dep, ~2 lines, per D10):

```ts
import { getDecodedToken } from '@cashu/cashu-ts';
import { tokenToMoney } from '../../internal/lib/cashu';
import { ReceiveCashuTokenService } from './receive-cashu-token-service';
import { ReceiveCashuTokenQuoteService } from '../../internal/orchestrator/receive-cashu-token-quote-service';
import { ClaimCashuTokenService } from '../../internal/orchestrator/claim-cashu-token-service';
import { SparkReceiveQuoteService } from '../spark/spark-receive-quote-service';
import { SparkReceiveQuoteRepository } from '../../internal/repositories/spark-receive-quote-repository';
import type { Ticker } from '../../types/exchange-rate';
// ...
  const { supabase, encryption, cashuCrypto, cashuWallets, cashuMintValidator } = ctx.connections;
  // ... existing repos/services ...
  const sparkReceiveQuoteService = new SparkReceiveQuoteService(
    new SparkReceiveQuoteRepository(supabase, encryption),
  );
  const receiveCashuTokenService = new ReceiveCashuTokenService(cashuWallets, cashuMintValidator);
  const claimCashuTokenService = new ClaimCashuTokenService({
    receiveSwapService,
    receiveCashuTokenQuoteService: new ReceiveCashuTokenQuoteService(
      receiveQuoteService,
      sparkReceiveQuoteService,
    ),
    getRate: (ticker: string) => exchangeRate.getRate(ticker as Ticker),
  });
```

- [ ] **Step 3b: Implement `receiveToken`** — replace the stub (`:188`):

```ts
      async receiveToken({
        token,
        destinationAccount,
      }: {
        token: string;
        destinationAccount?: Account;
      }): Promise<CashuReceiveQuote | SparkReceiveQuote | CashuReceiveSwap> {
        const userId = await requireUserId();
        const decoded = getDecodedToken(token);
        const sourceAccount = await receiveCashuTokenService.buildAccountForMint(
          decoded.mint,
          tokenToMoney(decoded).currency,
        );
        return claimCashuTokenService.claimToken({
          userId,
          token: decoded,
          sourceAccount,
          destinationAccount: destinationAccount ?? sourceAccount,
        });
      },
```

> Verify before writing: (a) `getDecodedToken` import path + arity from `@cashu/cashu-ts` (`node_modules/@cashu/cashu-ts` — for v2 keyset ids it takes an optional 2nd arg; omit it, matching the web's default decode). (b) `buildAccountForMint` returns a `CashuAccountWithTokenFlags` which `extends ExtendedCashuAccount` — confirm it is assignable to `claimToken`'s `sourceAccount: CashuAccount` / `destinationAccount: Account` (it carries the live `wallet`; a structural cast may be needed if the token-flag fields trip the type). (c) `SparkReceiveQuoteService` ctor arity (`(repository)`) and `SparkReceiveQuoteRepository` ctor `(supabase, encryption)`. (d) `tokenToMoney` is exported from `internal/lib/cashu`. (e) To keep the test off `mock.module`, prefer extracting the `getDecodedToken` call behind a tiny module-local `const decodeToken = getDecodedToken;` that the test `spyOn`s, OR test `receiveToken` with a real encoded token fixture so no decode stub is needed.

- [ ] **Step 4: Run it; expect PASS** — `bun test src/domains/cashu/cashu-domain.test.ts`. Expected: all pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/domains/cashu/cashu-domain.ts src/domains/cashu/cashu-domain.test.ts
git commit -m "feat(wallet-sdk): wire cashu.receive.receiveToken (decode + source resolve + claim)"
```

---

## Task 6: `WalletChangesForwarder` (realtime broadcast → SDK events)

**Files:**
- Create: `packages/wallet-sdk/src/internal/realtime/wallet-changes-forwarder.ts`
- Create: `packages/wallet-sdk/src/internal/realtime/wallet-changes-forwarder.test.ts`

**Interfaces:**
- Consumes: `SupabaseRealtimeManager` (`channel`/`addChannel`/`subscribe`/`removeChannel`); `TransactionRepository.toTransaction`; `AccountRepository.toAccount`; `toUser`.
- Produces: `class WalletChangesForwarder` with `constructor(deps: WalletChangesForwarderDeps)`, `start(userId: string): Promise<void>` (subscribes the `wallet:<userId>` private broadcast channel; maps `TRANSACTION_CREATED/UPDATED` → `transaction:created/:updated`, `ACCOUNT_CREATED/UPDATED` → `account:updated {op}`, `USER_UPDATED` → `user:updated`; ignores all other events incl. `CONTACT_*` and `CASHU_*`/`SPARK_*`), and `stop(): Promise<void>` (removes the channel).

- [ ] **Step 1: Write the failing test** — `wallet-changes-forwarder.test.ts` (DI a fake realtime manager that captures the broadcast callback so the test can fire synthetic events; fake repos return canned entities; real `SdkEventEmitter`).

```ts
import { describe, expect, it, mock } from 'bun:test';
import { SdkEventEmitter } from '../event-emitter';
import type { SdkEventMap } from '../../events';
import { WalletChangesForwarder } from './wallet-changes-forwarder';

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeRealtime() {
  let broadcastCb: ((m: { type: 'broadcast'; event: string; payload: unknown }) => void) | undefined;
  const subscribe = mock(async () => {});
  const removeChannel = mock(async () => {});
  const builder = {
    topic: 'realtime:wallet:user-1',
    on: mock((_type: string, _filter: unknown, cb: (m: { type: 'broadcast'; event: string; payload: unknown }) => void) => {
      broadcastCb = cb;
      return builder;
    }),
  };
  const channel = mock(() => builder);
  const addChannel = mock(() => ({ topic: builder.topic }));
  const realtime = { channel, addChannel, subscribe, removeChannel } as never;
  return { realtime, subscribe, removeChannel, fire: (event: string, payload: unknown) => broadcastCb?.({ type: 'broadcast', event, payload }) };
}

function setup() {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const events: { name: string; data: unknown }[] = [];
  (['transaction:created', 'transaction:updated', 'account:updated', 'user:updated', 'contact:created', 'contact:deleted'] as const)
    .forEach((name) => emitter.on(name, (data) => events.push({ name, data })));
  const rt = fakeRealtime();
  const transactionRepository = { toTransaction: mock(async (row: { id: string; version: number }) => ({ id: row.id, version: row.version })) } as never;
  const accountRepository = { toAccount: mock(async (row: { id: string }) => ({ id: row.id })) } as never;
  const toUser = mock((row: { id: string }) => ({ id: row.id, username: 'u' }));
  const forwarder = new WalletChangesForwarder({ realtime: rt.realtime, emitter, transactionRepository, accountRepository, toUser });
  return { forwarder, emitter, events, rt, toUser };
}

describe('WalletChangesForwarder', () => {
  it('subscribes the private wallet:<userId> broadcast channel on start', async () => {
    const { forwarder, rt } = setup();
    await forwarder.start('user-1');
    expect(rt.subscribe).toHaveBeenCalledTimes(1);
  });

  it('maps TRANSACTION_CREATED/UPDATED to transaction:created/:updated', async () => {
    const { forwarder, events, rt } = setup();
    await forwarder.start('user-1');
    rt.fire('TRANSACTION_CREATED', { id: 'tx-1', version: 1 });
    rt.fire('TRANSACTION_UPDATED', { id: 'tx-1', version: 2 });
    await flush();
    expect(events.map((e) => e.name)).toEqual(['transaction:created', 'transaction:updated']);
  });

  it('maps ACCOUNT_CREATED/UPDATED to account:updated with the right op', async () => {
    const { forwarder, events, rt } = setup();
    await forwarder.start('user-1');
    rt.fire('ACCOUNT_CREATED', { id: 'acc-1' });
    rt.fire('ACCOUNT_UPDATED', { id: 'acc-1' });
    await flush();
    expect(events).toEqual([
      { name: 'account:updated', data: { account: { id: 'acc-1' }, op: 'created' } },
      { name: 'account:updated', data: { account: { id: 'acc-1' }, op: 'updated' } },
    ]);
  });

  it('maps USER_UPDATED to user:updated', async () => {
    const { forwarder, events, rt } = setup();
    await forwarder.start('user-1');
    rt.fire('USER_UPDATED', { id: 'user-1' });
    await flush();
    expect(events).toEqual([{ name: 'user:updated', data: { user: { id: 'user-1', username: 'u' } } }]);
  });

  it('does NOT drive contact events (S8 owns them) or quote/swap events', async () => {
    const { forwarder, events, rt } = setup();
    await forwarder.start('user-1');
    rt.fire('CONTACT_CREATED', { id: 'c-1' });
    rt.fire('CONTACT_DELETED', { id: 'c-1' });
    rt.fire('CASHU_SEND_QUOTE_UPDATED', { id: 'q-1' });
    await flush();
    expect(events).toHaveLength(0);
  });

  it('removes the channel on stop', async () => {
    const { forwarder, rt } = setup();
    await forwarder.start('user-1');
    await forwarder.stop();
    expect(rt.removeChannel).toHaveBeenCalledTimes(1);
  });
});
```

> Verify before writing: the manager's `channel(topic, { private })` → builder, `addChannel(builder)` → wrapper, `subscribe(topic)` flow and that the builder's broadcast callback param is `{ type, event, payload }` (`supabase-realtime-channel-builder.ts:102-127`). Inject `toUser` as a dep (a thin seam over the free `internal/db/user-mapper.ts` `toUser`) so the test needs no module mock.

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/realtime/wallet-changes-forwarder.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `wallet-changes-forwarder.ts`

```ts
import type { Account } from '../../types/account';
import type { User } from '../../types/user';
import type { SdkEventMap } from '../../events';
import type {
  AgicashDbAccountWithProofs,
  AgicashDbUser,
  Database,
} from '../db/database';
import type { AccountRepository } from '../repositories/account-repository';
import type { TransactionRepository } from '../repositories/transaction-repository';
import type { SdkEventEmitter } from '../event-emitter';
import type { SupabaseRealtimeManager } from './supabase-realtime-manager';

type TransactionRow = Database['wallet']['Functions']['list_transactions']['Returns'][number];

export type WalletChangesForwarderDeps = {
  realtime: SupabaseRealtimeManager;
  emitter: SdkEventEmitter<SdkEventMap>;
  transactionRepository: TransactionRepository;
  accountRepository: AccountRepository;
  toUser: (dbUser: AgicashDbUser) => User;
};

type BroadcastMessage = {
  type: 'broadcast';
  event: string;
  payload: unknown;
};

/**
 * Forwards server-written wallet row changes (the single private `wallet:<userId>`
 * broadcast channel) to SDK events. Drives only entities the SDK cannot observe by
 * local mutation: transactions, accounts, user. Contacts are intentionally NOT
 * forwarded — the contacts domain emits `contact:created`/`:deleted` synchronously
 * and the consumer cache has no version to dedupe a double-drive (see plan D2).
 * Quote/swap (`CASHU_*`/`SPARK_*`) broadcasts are not forwarded — the orchestrators
 * emit `send:*`/`receive:*` on real transitions. Runs whenever started, regardless
 * of leadership.
 */
export class WalletChangesForwarder {
  private topic: string | null = null;

  constructor(private readonly deps: WalletChangesForwarderDeps) {}

  async start(userId: string): Promise<void> {
    if (this.topic) return;
    const builder = this.deps.realtime
      .channel(`wallet:${userId}`, { private: true })
      .on('broadcast', { event: '*' }, (message) => {
        const { event, payload } = message as BroadcastMessage;
        void this.handle(event, payload).catch((error) =>
          console.error('wallet changes forwarder failed', { event, cause: error }),
        );
      });
    this.deps.realtime.addChannel(builder);
    this.topic = builder.topic;
    await this.deps.realtime.subscribe(this.topic);
  }

  async stop(): Promise<void> {
    if (!this.topic) return;
    const topic = this.topic;
    this.topic = null;
    await this.deps.realtime.removeChannel(topic);
  }

  private async handle(event: string, payload: unknown): Promise<void> {
    switch (event) {
      case 'TRANSACTION_CREATED': {
        const transaction = await this.deps.transactionRepository.toTransaction(payload as TransactionRow);
        this.deps.emitter.emit('transaction:created', { transaction });
        return;
      }
      case 'TRANSACTION_UPDATED': {
        const transaction = await this.deps.transactionRepository.toTransaction(payload as TransactionRow);
        this.deps.emitter.emit('transaction:updated', { transaction });
        return;
      }
      case 'ACCOUNT_CREATED': {
        const account = await this.deps.accountRepository.toAccount(payload as AgicashDbAccountWithProofs);
        this.deps.emitter.emit('account:updated', { account, op: 'created' });
        return;
      }
      case 'ACCOUNT_UPDATED': {
        const account = await this.deps.accountRepository.toAccount(payload as AgicashDbAccountWithProofs);
        this.deps.emitter.emit('account:updated', { account, op: 'updated' });
        return;
      }
      case 'USER_UPDATED': {
        const user = this.deps.toUser(payload as AgicashDbUser);
        this.deps.emitter.emit('user:updated', { user });
        return;
      }
      default:
        return; // CONTACT_*, CASHU_*, SPARK_*, etc. — not forwarded
    }
  }
}
```

> The unused `Account` import will be used implicitly via `toAccount`'s return; drop it if `tsc` complains. Verify `User` import path (`types/user`) and the `TransactionRow` alias matches `transaction-repository.ts:17`.

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/realtime/wallet-changes-forwarder.test.ts`. Expected: 6 pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/realtime/wallet-changes-forwarder.ts src/internal/realtime/wallet-changes-forwarder.test.ts
git commit -m "feat(wallet-sdk): realtime wallet-changes forwarder (transaction/account/user; contacts excluded)"
```

---

## Task 7: `TaskLoop.runOnce` — one reconcile pass over the six work-lists

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/task-loop.ts`
- Create: `packages/wallet-sdk/src/internal/background/task-loop.test.ts`

**Interfaces:**
- Consumes: the six repos' `getUnresolved`/`getPending`; the six orchestrators' per-tick entry points; the shared `initiateMelt`/`getUserId`.
- Produces: `class TaskLoop` with `constructor(deps: TaskLoopDeps)`, `runOnce(): Promise<void>` (reads each work-list, drives the cashu orchestrators (void), captures+rotates the spark cleanup thunks), and `dispose(): void` (invokes the held spark thunks). The expiry sweep is added in Task 8.

```ts
// task-loop.ts deps shape (Produces)
export type TaskLoopDeps = {
  repos: {
    cashuSendQuote: { getUnresolved(userId: string): Promise<CashuSendQuote[]> };
    cashuSendSwap: { getUnresolved(userId: string): Promise<CashuSendSwap[]> };
    cashuReceiveQuote: { getPending(userId: string): Promise<CashuReceiveQuote[]> };
    cashuReceiveSwap: { getPending(userId: string): Promise<CashuReceiveSwap[]> };
    sparkSendQuote: { getUnresolved(userId: string): Promise<SparkSendQuote[]> };
    sparkReceiveQuote: { getPending(userId: string): Promise<SparkReceiveQuote[]> };
  };
  orchestrators: {
    cashuSend: { reconcile(quotes: CashuSendQuote[]): Promise<void> };
    cashuSendSwap: { processDrafts(swaps: CashuSendSwap[]): Promise<void>; reconcile(pending: CashuSendSwap[]): Promise<void> };
    cashuReceiveQuote: {
      reconcileMintQuotes(quotes: CashuReceiveQuote[]): Promise<void>;
      reconcileCrossMintMelts(quotes: (CashuReceiveQuote & { type: 'CASHU_TOKEN' })[], handlers: { initiateMelt: InitiateMelt }): Promise<void>;
    };
    cashuReceiveSwap: { processPending(swaps: CashuReceiveSwap[]): Promise<void> };
    sparkSend: { reconcile(quotes: SparkSendQuote[]): Promise<() => void> };
    sparkReceive: {
      reconcile(quotes: SparkReceiveQuote[]): Promise<() => void>;
      reconcileCrossMintMelts(quotes: SparkReceiveQuote[], handlers: { initiateMelt: InitiateMelt }): Promise<void>;
      applyExpiry(quote: SparkReceiveQuote): Promise<void>;
    };
  };
  cashuReceiveQuoteService: { expire(quote: CashuReceiveQuote): Promise<void> };
  cashuSendQuoteService: { expireSendQuote(quote: CashuSendQuote): Promise<void> };
  initiateMelt: InitiateMelt;
  getUserId: () => Promise<string | null>;
  emitter: SdkEventEmitter<SdkEventMap>;
};
export type InitiateMelt = (quote: { tokenReceiveData: CashuTokenMeltData }) => Promise<void>;
```

- [ ] **Step 1: Write the failing test** — `task-loop.test.ts` (fake repos return canned lists; fake orchestrators are spies; assert each is called with its list and that the spark cleanup thunks rotate).

```ts
import { describe, expect, it, mock } from 'bun:test';
import { SdkEventEmitter } from '../event-emitter';
import type { SdkEventMap } from '../../events';
import { TaskLoop } from './task-loop';

const unresolvedCashuSend = [{ id: 'cs-1', state: 'UNPAID', accountId: 'a' }];
const unresolvedCashuSwap = [{ id: 'css-1', state: 'DRAFT' }, { id: 'css-2', state: 'PENDING' }];
const pendingCashuReceive = [{ id: 'crq-1', type: 'LIGHTNING', state: 'UNPAID' }, { id: 'crq-2', type: 'CASHU_TOKEN', state: 'UNPAID' }];
const pendingCashuReceiveSwap = [{ tokenHash: 'h', state: 'PENDING' }];
const unresolvedSparkSend = [{ id: 'ss-1', state: 'UNPAID' }];
const pendingSparkReceive = [{ id: 'srq-1', type: 'LIGHTNING', state: 'UNPAID' }];

function setup() {
  const calls: string[] = [];
  const repos = {
    cashuSendQuote: { getUnresolved: mock(async () => unresolvedCashuSend) },
    cashuSendSwap: { getUnresolved: mock(async () => unresolvedCashuSwap) },
    cashuReceiveQuote: { getPending: mock(async () => pendingCashuReceive) },
    cashuReceiveSwap: { getPending: mock(async () => pendingCashuReceiveSwap) },
    sparkSendQuote: { getUnresolved: mock(async () => unresolvedSparkSend) },
    sparkReceiveQuote: { getPending: mock(async () => pendingSparkReceive) },
  } as never;

  const sparkSendCleanup = mock(() => {});
  const sparkReceiveCleanup = mock(() => {});
  const orchestrators = {
    cashuSend: { reconcile: mock(async () => { calls.push('cashuSend.reconcile'); }) },
    cashuSendSwap: {
      processDrafts: mock(async () => { calls.push('cashuSendSwap.processDrafts'); }),
      reconcile: mock(async () => { calls.push('cashuSendSwap.reconcile'); }),
    },
    cashuReceiveQuote: {
      reconcileMintQuotes: mock(async () => { calls.push('cashuReceiveQuote.reconcileMintQuotes'); }),
      reconcileCrossMintMelts: mock(async () => { calls.push('cashuReceiveQuote.reconcileCrossMintMelts'); }),
    },
    cashuReceiveSwap: { processPending: mock(async () => { calls.push('cashuReceiveSwap.processPending'); }) },
    sparkSend: { reconcile: mock(async () => sparkSendCleanup) },
    sparkReceive: {
      reconcile: mock(async () => sparkReceiveCleanup),
      reconcileCrossMintMelts: mock(async () => {}),
      applyExpiry: mock(async () => {}),
    },
  } as never;

  const loop = new TaskLoop({
    repos,
    orchestrators,
    cashuReceiveQuoteService: { expire: mock(async () => {}) } as never,
    cashuSendQuoteService: { expireSendQuote: mock(async () => {}) } as never,
    initiateMelt: mock(async () => {}),
    getUserId: mock(async () => 'user-1'),
    emitter: new SdkEventEmitter<SdkEventMap>(),
  });
  return { loop, repos, orchestrators, calls, sparkSendCleanup, sparkReceiveCleanup };
}

describe('TaskLoop.runOnce', () => {
  it('no-ops when there is no user', async () => {
    const { loop, orchestrators } = setup();
    (loop as unknown as { deps: { getUserId: () => Promise<string | null> } }).deps.getUserId = mock(async () => null);
    await loop.runOnce();
    expect(orchestrators.cashuSend.reconcile).not.toHaveBeenCalled();
  });

  it('drives every orchestrator with its work-list', async () => {
    const { loop, orchestrators } = setup();
    await loop.runOnce();
    expect(orchestrators.cashuSend.reconcile).toHaveBeenCalledWith(unresolvedCashuSend);
    expect(orchestrators.cashuSendSwap.processDrafts).toHaveBeenCalledWith(unresolvedCashuSwap);
    expect(orchestrators.cashuSendSwap.reconcile).toHaveBeenCalled();
    expect(orchestrators.cashuReceiveQuote.reconcileMintQuotes).toHaveBeenCalledWith(pendingCashuReceive);
    expect(orchestrators.cashuReceiveQuote.reconcileCrossMintMelts).toHaveBeenCalled();
    expect(orchestrators.cashuReceiveSwap.processPending).toHaveBeenCalledWith(pendingCashuReceiveSwap);
    expect(orchestrators.sparkSend.reconcile).toHaveBeenCalledWith(unresolvedSparkSend);
    expect(orchestrators.sparkReceive.reconcile).toHaveBeenCalledWith(pendingSparkReceive);
  });

  it('passes only CASHU_TOKEN receive quotes to reconcileCrossMintMelts', async () => {
    const { loop, orchestrators } = setup();
    await loop.runOnce();
    const arg = (orchestrators.cashuReceiveQuote.reconcileCrossMintMelts as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { type: string }[];
    expect(arg.every((q) => q.type === 'CASHU_TOKEN')).toBe(true);
  });

  it('disposes the prior tick spark thunks before re-reconciling', async () => {
    const { loop, sparkSendCleanup, sparkReceiveCleanup } = setup();
    await loop.runOnce(); // captures thunks
    await loop.runOnce(); // should dispose the prior ones first
    expect(sparkSendCleanup).toHaveBeenCalledTimes(1);
    expect(sparkReceiveCleanup).toHaveBeenCalledTimes(1);
  });

  it('dispose() invokes the held spark thunks', async () => {
    const { loop, sparkSendCleanup, sparkReceiveCleanup } = setup();
    await loop.runOnce();
    loop.dispose();
    expect(sparkSendCleanup).toHaveBeenCalledTimes(1);
    expect(sparkReceiveCleanup).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/background/task-loop.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `task-loop.ts` (the expiry-sweep methods are added in Task 8; for now `runOnce` ends after the reconcile pass).

```ts
import type { CashuTokenMeltData } from '../../types/cashu';
import type { CashuReceiveQuote, CashuSendQuote, CashuSendSwap, CashuReceiveSwap } from '../../types/cashu';
import type { SparkReceiveQuote, SparkSendQuote } from '../../types/spark';
import type { SdkEventMap } from '../../events';
import type { SdkEventEmitter } from '../event-emitter';

export type InitiateMelt = (quote: { tokenReceiveData: CashuTokenMeltData }) => Promise<void>;

export type TaskLoopDeps = {
  repos: {
    cashuSendQuote: { getUnresolved(userId: string): Promise<CashuSendQuote[]> };
    cashuSendSwap: { getUnresolved(userId: string): Promise<CashuSendSwap[]> };
    cashuReceiveQuote: { getPending(userId: string): Promise<CashuReceiveQuote[]> };
    cashuReceiveSwap: { getPending(userId: string): Promise<CashuReceiveSwap[]> };
    sparkSendQuote: { getUnresolved(userId: string): Promise<SparkSendQuote[]> };
    sparkReceiveQuote: { getPending(userId: string): Promise<SparkReceiveQuote[]> };
  };
  orchestrators: {
    cashuSend: { reconcile(quotes: CashuSendQuote[]): Promise<void> };
    cashuSendSwap: { processDrafts(swaps: CashuSendSwap[]): Promise<void>; reconcile(pending: CashuSendSwap[]): Promise<void> };
    cashuReceiveQuote: {
      reconcileMintQuotes(quotes: CashuReceiveQuote[]): Promise<void>;
      reconcileCrossMintMelts(quotes: (CashuReceiveQuote & { type: 'CASHU_TOKEN' })[], handlers: { initiateMelt: InitiateMelt }): Promise<void>;
    };
    cashuReceiveSwap: { processPending(swaps: CashuReceiveSwap[]): Promise<void> };
    sparkSend: { reconcile(quotes: SparkSendQuote[]): Promise<() => void> };
    sparkReceive: {
      reconcile(quotes: SparkReceiveQuote[]): Promise<() => void>;
      reconcileCrossMintMelts(quotes: SparkReceiveQuote[], handlers: { initiateMelt: InitiateMelt }): Promise<void>;
      applyExpiry(quote: SparkReceiveQuote): Promise<void>;
    };
  };
  cashuReceiveQuoteService: { expire(quote: CashuReceiveQuote): Promise<void> };
  cashuSendQuoteService: { expireSendQuote(quote: CashuSendQuote): Promise<void> };
  initiateMelt: InitiateMelt;
  getUserId: () => Promise<string | null>;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/**
 * One leader-side reconciliation pass over the six unresolved/pending work-lists.
 * Cashu orchestrators own their WS subscriptions (idempotent; reconcile returns void).
 * Spark orchestrators return cleanup thunks (raw Breez listeners); the loop disposes
 * the prior tick's thunks before re-reconciling and on `dispose()`.
 */
export class TaskLoop {
  private sparkSendCleanup: (() => void) | null = null;
  private sparkReceiveCleanup: (() => void) | null = null;

  constructor(private readonly deps: TaskLoopDeps) {}

  async runOnce(): Promise<void> {
    const userId = await this.deps.getUserId();
    if (!userId) return;

    this.disposeSparkThunks();

    const { repos, orchestrators, initiateMelt } = this.deps;
    const [cashuSend, cashuSwap, cashuReceive, cashuReceiveSwap, sparkSend, sparkReceive] =
      await Promise.all([
        repos.cashuSendQuote.getUnresolved(userId),
        repos.cashuSendSwap.getUnresolved(userId),
        repos.cashuReceiveQuote.getPending(userId),
        repos.cashuReceiveSwap.getPending(userId),
        repos.sparkSendQuote.getUnresolved(userId),
        repos.sparkReceiveQuote.getPending(userId),
      ]);

    // Cashu — manager-owned, idempotent subscriptions (reconcile returns void).
    await orchestrators.cashuSend.reconcile(cashuSend);
    await orchestrators.cashuSendSwap.processDrafts(cashuSwap);
    await orchestrators.cashuSendSwap.reconcile(cashuSwap.filter((s) => s.state === 'PENDING'));
    await orchestrators.cashuReceiveQuote.reconcileMintQuotes(cashuReceive);
    await orchestrators.cashuReceiveQuote.reconcileCrossMintMelts(
      cashuReceive.filter((q): q is CashuReceiveQuote & { type: 'CASHU_TOKEN' } => q.type === 'CASHU_TOKEN'),
      { initiateMelt },
    );
    await orchestrators.cashuReceiveSwap.processPending(cashuReceiveSwap);

    // Spark — caller-owned cleanup thunks (raw Breez listeners).
    this.sparkSendCleanup = await orchestrators.sparkSend.reconcile(sparkSend);
    this.sparkReceiveCleanup = await orchestrators.sparkReceive.reconcile(sparkReceive);
    await orchestrators.sparkReceive.reconcileCrossMintMelts(sparkReceive, { initiateMelt });

    // Expiry sweep is added in Task 8.
  }

  dispose(): void {
    this.disposeSparkThunks();
  }

  private disposeSparkThunks(): void {
    this.sparkSendCleanup?.();
    this.sparkReceiveCleanup?.();
    this.sparkSendCleanup = null;
    this.sparkReceiveCleanup = null;
  }
}
```

> Verify before writing: `CashuSendSwapOrchestrator.processDrafts` — does it filter `DRAFT` internally or expect only drafts? If it filters internally, passing the full `cashuSwap` list is fine (as written); if it expects only drafts, change to `processDrafts(cashuSwap.filter((s) => s.state === 'DRAFT'))`. Read `cashu-send-swap-orchestrator.ts` and match. Likewise confirm `reconcile`'s param type accepts the `PENDING`-filtered list (`PendingCashuSendSwap[]`); a structural cast may be needed.

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/background/task-loop.test.ts`. Expected: 6 pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/background/task-loop.ts src/internal/background/task-loop.test.ts
git commit -m "feat(wallet-sdk): background task loop reconcile pass (six work-lists, spark thunk rotation)"
```

---

## Task 8: `TaskLoop` quote-expiry sweep (cashu send/receive + spark receive)

**Files:**
- Modify: `packages/wallet-sdk/src/internal/background/task-loop.ts`
- Modify: `packages/wallet-sdk/src/internal/background/task-loop.test.ts`

**Interfaces:**
- Produces: `TaskLoop.runOnce` additionally sweeps expiry — cashu send UNPAID+expired → `cashuSendQuoteService.expireSendQuote` (no event); cashu receive UNPAID+expired → `cashuReceiveQuoteService.expire` + emit `receive:expired {quoteId, protocol:'cashu'}`; spark receive → `sparkReceive.applyExpiry(q)` per UNPAID quote (the orchestrator guards + emits).

- [ ] **Step 1: Write the failing test** — append to `task-loop.test.ts`

```ts
describe('TaskLoop.runOnce expiry sweep', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();

  it('expires an UNPAID+expired cashu send quote (no event)', async () => {
    const { loop, repos, orchestrators } = setup();
    (repos.cashuSendQuote.getUnresolved as unknown as { mockImplementation: (f: () => Promise<unknown>) => void })
      .mockImplementation(async () => [{ id: 'cs-x', state: 'UNPAID', accountId: 'a', expiresAt: past }]);
    const expireSendQuote = (loop as unknown as { deps: { cashuSendQuoteService: { expireSendQuote: ReturnType<typeof mock> } } }).deps.cashuSendQuoteService.expireSendQuote;
    await loop.runOnce();
    expect(expireSendQuote).toHaveBeenCalledTimes(1);
    expect(orchestrators.cashuSend.reconcile).toHaveBeenCalled(); // reconcile still runs
  });

  it('expires an UNPAID+expired cashu receive quote and emits receive:expired', async () => {
    const { loop, repos } = setup();
    const emitter = (loop as unknown as { deps: { emitter: SdkEventEmitter<SdkEventMap> } }).deps.emitter;
    const expired: unknown[] = [];
    emitter.on('receive:expired', (e) => expired.push(e));
    (repos.cashuReceiveQuote.getPending as unknown as { mockImplementation: (f: () => Promise<unknown>) => void })
      .mockImplementation(async () => [{ id: 'crq-x', type: 'LIGHTNING', state: 'UNPAID', expiresAt: past }]);
    await loop.runOnce();
    expect(expired).toEqual([{ quoteId: 'crq-x', protocol: 'cashu' }] as never);
  });

  it('does NOT expire a not-yet-expired cashu receive quote', async () => {
    const { loop, repos } = setup();
    const emitter = (loop as unknown as { deps: { emitter: SdkEventEmitter<SdkEventMap> } }).deps.emitter;
    const expired: unknown[] = [];
    emitter.on('receive:expired', (e) => expired.push(e));
    (repos.cashuReceiveQuote.getPending as unknown as { mockImplementation: (f: () => Promise<unknown>) => void })
      .mockImplementation(async () => [{ id: 'crq-y', type: 'LIGHTNING', state: 'UNPAID', expiresAt: future }]);
    await loop.runOnce();
    expect(expired).toHaveLength(0);
  });

  it('runs spark applyExpiry for each pending spark receive quote', async () => {
    const { loop, orchestrators } = setup();
    await loop.runOnce();
    expect(orchestrators.sparkReceive.applyExpiry).toHaveBeenCalledTimes(pendingSparkReceive.length);
  });
});
```

> `mock(...)` from `bun:test` supports `mockImplementation`; if the harness's `mock` lacks it, re-create the loop per test with the desired repo stubs instead of reassigning.

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/background/task-loop.test.ts -t "expiry sweep"`. Expected: FAIL (no expiry behaviour).

- [ ] **Step 3: Implement** — in `task-loop.ts`, add the sweep calls inside `runOnce` (after the respective reconciles) and the helper methods:

```ts
    // ... after orchestrators.cashuSend.reconcile(cashuSend):
    await this.sweepCashuSendExpiry(cashuSend);
    // ... after orchestrators.cashuReceiveSwap.processPending(...):
    await this.sweepCashuReceiveExpiry(cashuReceive);
    // ... after orchestrators.sparkReceive.reconcileCrossMintMelts(...):
    await this.sweepSparkReceiveExpiry(sparkReceive);
```

```ts
  private isExpired(expiresAt: string | null | undefined): boolean {
    return expiresAt != null && new Date(expiresAt) < new Date();
  }

  private async sweepCashuSendExpiry(quotes: CashuSendQuote[]): Promise<void> {
    for (const quote of quotes) {
      if (quote.state !== 'UNPAID' || !this.isExpired(quote.expiresAt)) continue;
      await this.deps.cashuSendQuoteService.expireSendQuote(quote).catch((error) =>
        console.error('cashu send expiry failed', { quoteId: quote.id, cause: error }),
      );
    }
  }

  private async sweepCashuReceiveExpiry(quotes: CashuReceiveQuote[]): Promise<void> {
    for (const quote of quotes) {
      if (quote.state !== 'UNPAID' || !this.isExpired(quote.expiresAt)) continue;
      try {
        await this.deps.cashuReceiveQuoteService.expire(quote);
        this.deps.emitter.emit('receive:expired', { quoteId: quote.id, protocol: 'cashu' });
      } catch (error) {
        console.error('cashu receive expiry failed', { quoteId: quote.id, cause: error });
      }
    }
  }

  private async sweepSparkReceiveExpiry(quotes: SparkReceiveQuote[]): Promise<void> {
    for (const quote of quotes) {
      await this.deps.orchestrators.sparkReceive.applyExpiry(quote).catch((error) =>
        console.error('spark receive expiry failed', { quoteId: quote.id, cause: error }),
      );
    }
  }
```

> `CashuSendQuote.expiresAt` is `string | null`; `CashuReceiveQuote.expiresAt` is `string` (non-null) — `isExpired` handles both. The `try/catch` around cashu receive `expire` is the transition gate: `expire` throws if the quote is not UNPAID (race), so a no-op produces no emit; and an expired quote drops out of next tick's `getPending` so it is swept at most once.

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/background/task-loop.test.ts`. Expected: all pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/background/task-loop.ts src/internal/background/task-loop.test.ts
git commit -m "feat(wallet-sdk): background task loop quote-expiry sweep (cashu send/receive + spark receive)"
```

---

## Task 9: `BackgroundRunner` — leader poll + lifecycle state machine + balance listeners

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/background-runner.ts`
- Create: `packages/wallet-sdk/src/internal/background/background-runner.test.ts`

**Interfaces:**
- Consumes: `TaskProcessingLockRepository.takeLead`; `TaskLoop.runOnce`/`dispose`; `WalletChangesForwarder.start`/`stop`; a `registerBalanceListeners(userId) => Promise<() => void>` thunk; `getCurrentUserId`.
- Produces: `class BackgroundRunner` with `constructor(deps: BackgroundRunnerDeps)`, `start(): Promise<void>`, `stop(): Promise<void>`, `state(): BackgroundState`, and `runTick(): Promise<void>` (one leader-poll-and-maybe-process pass; `start()` schedules it on a 5s interval, tests call it directly).

```ts
export type BackgroundRunnerDeps = {
  lockRepository: { takeLead(userId: string, clientId: string): Promise<boolean> };
  taskLoop: { runOnce(): Promise<void>; dispose(): void };
  forwarder: { start(userId: string): Promise<void>; stop(): Promise<void> };
  registerBalanceListeners: (userId: string) => Promise<() => void>;
  getUserId: () => Promise<string | null>;
  clientId: string;
  emitter: SdkEventEmitter<SdkEventMap>;
  pollIntervalMs?: number; // default 5000
};
```

- [ ] **Step 1: Write the failing test** — `background-runner.test.ts`

```ts
import { describe, expect, it, mock } from 'bun:test';
import { SdkEventEmitter } from '../event-emitter';
import type { SdkEventMap } from '../../events';
import { BackgroundRunner } from './background-runner';

function setup(opts: { takeLead?: (n: number) => boolean } = {}) {
  let tick = 0;
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const states: string[] = [];
  emitter.on('background:state', (e) => states.push(e.state));
  const balanceCleanup = mock(() => {});
  const deps = {
    lockRepository: { takeLead: mock(async () => (opts.takeLead ? opts.takeLead(tick++) : true)) },
    taskLoop: { runOnce: mock(async () => {}), dispose: mock(() => {}) },
    forwarder: { start: mock(async () => {}), stop: mock(async () => {}) },
    registerBalanceListeners: mock(async () => balanceCleanup),
    getUserId: mock(async () => 'user-1'),
    clientId: 'client-1',
    emitter,
    pollIntervalMs: 5000,
  };
  const runner = new BackgroundRunner(deps);
  return { runner, deps, states, balanceCleanup };
}

describe('BackgroundRunner', () => {
  it('start() goes stopped → starting → (after first tick as leader) leader, starting the forwarder + balance listeners', async () => {
    const { runner, deps, states } = setup({ takeLead: () => true });
    await runner.start();
    expect(deps.forwarder.start).toHaveBeenCalledWith('user-1');
    expect(deps.registerBalanceListeners).toHaveBeenCalledWith('user-1');
    expect(runner.state()).toBe('leader');
    expect(states).toContain('starting');
    expect(states).toContain('leader');
    expect(deps.taskLoop.runOnce).toHaveBeenCalledTimes(1); // immediate first tick
  });

  it('a tick that loses the lead → follower, disposes the spark thunks, does NOT run the loop', async () => {
    const { runner, deps } = setup({ takeLead: (n) => n === 0 }); // leader first tick, follower after
    await runner.start(); // tick 0 → leader (runOnce #1)
    await runner.runTick(); // tick 1 → follower
    expect(runner.state()).toBe('follower');
    expect(deps.taskLoop.dispose).toHaveBeenCalled();
    expect(deps.taskLoop.runOnce).toHaveBeenCalledTimes(1); // not called again as follower
  });

  it('start() with no user stays starting and runs no tick body', async () => {
    const { runner, deps } = setup();
    deps.getUserId = mock(async () => null) as never;
    const r = new BackgroundRunner({ ...deps });
    await r.start();
    expect(deps.forwarder.start).not.toHaveBeenCalled();
    expect(r.state()).toBe('starting');
  });

  it('a take_lead error is swallowed (stays follower, retries next tick)', async () => {
    const { runner, deps } = setup();
    deps.lockRepository.takeLead = mock(async () => { throw new Error('rpc down'); }) as never;
    const r = new BackgroundRunner({ ...deps });
    await r.start();
    await expect(r.runTick()).resolves.toBeUndefined();
    expect(r.state()).toBe('follower');
  });

  it('stop() goes → stopping → stopped, stops forwarder, disposes loop + balance listeners', async () => {
    const { runner, deps, balanceCleanup } = setup({ takeLead: () => true });
    await runner.start();
    await runner.stop();
    expect(deps.forwarder.stop).toHaveBeenCalledTimes(1);
    expect(deps.taskLoop.dispose).toHaveBeenCalled();
    expect(balanceCleanup).toHaveBeenCalledTimes(1);
    expect(runner.state()).toBe('stopped');
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/background/background-runner.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `background-runner.ts`

```ts
import type { BackgroundState, SdkEventMap } from '../../events';
import type { SdkEventEmitter } from '../event-emitter';

export type BackgroundRunnerDeps = {
  lockRepository: { takeLead(userId: string, clientId: string): Promise<boolean> };
  taskLoop: { runOnce(): Promise<void>; dispose(): void };
  forwarder: { start(userId: string): Promise<void>; stop(): Promise<void> };
  registerBalanceListeners: (userId: string) => Promise<() => void>;
  getUserId: () => Promise<string | null>;
  clientId: string;
  emitter: SdkEventEmitter<SdkEventMap>;
  pollIntervalMs?: number;
};

/**
 * Auth-lifecycle background engine: on `start()` it subscribes the realtime
 * forwarder + per-account spark balance listeners (always-on, not leader-gated),
 * then polls `take_lead` every `pollIntervalMs` (default 5s). On each tick, when it
 * holds the lead it runs one `TaskLoop` pass; when it loses the lead it disposes the
 * loop's spark listeners and processes nothing. No connectivity seam (spec D10).
 */
export class BackgroundRunner {
  private currentState: BackgroundState = 'stopped';
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private userId: string | null = null;
  private balanceCleanup: (() => void) | null = null;

  constructor(private readonly deps: BackgroundRunnerDeps) {}

  state(): BackgroundState {
    return this.currentState;
  }

  async start(): Promise<void> {
    if (this.currentState !== 'stopped') return;
    this.setState('starting');
    const userId = await this.deps.getUserId();
    if (!userId) return; // stays 'starting'; the consumer should call stop() then start() once authed
    this.userId = userId;

    await this.deps.forwarder.start(userId);
    this.balanceCleanup = await this.deps.registerBalanceListeners(userId);

    await this.runTick();
    this.intervalId = setInterval(() => {
      void this.runTick().catch((error) =>
        console.error('background tick failed', { cause: error }),
      );
    }, this.deps.pollIntervalMs ?? 5000);
  }

  async runTick(): Promise<void> {
    if (this.currentState === 'stopped' || this.currentState === 'stopping') return;
    if (!this.userId) return;

    let isLeader = false;
    try {
      isLeader = await this.deps.lockRepository.takeLead(this.userId, this.deps.clientId);
    } catch (error) {
      // FK errors before the user row exists, transient RPC failures — log + retry next tick.
      console.warn('take_lead failed; retrying next tick', { cause: error });
      isLeader = false;
    }

    if (isLeader) {
      this.setState('leader');
      await this.deps.taskLoop.runOnce();
    } else {
      if (this.currentState === 'leader') this.deps.taskLoop.dispose();
      this.setState('follower');
    }
  }

  async stop(): Promise<void> {
    if (this.currentState === 'stopped' || this.currentState === 'stopping') return;
    this.setState('stopping');
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.deps.taskLoop.dispose();
    this.balanceCleanup?.();
    this.balanceCleanup = null;
    await this.deps.forwarder.stop();
    this.userId = null;
    this.setState('stopped');
  }

  private setState(state: BackgroundState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.deps.emitter.emit('background:state', { state });
  }
}
```

> Note: `setState` de-dupes so a leader staying leader across ticks does not re-emit `background:state`. The `start()`-with-no-user case stays `'starting'` (the web only mounts background when authed, so this is a defensive guard, not a normal path). `setInterval`/`clearInterval` use the global timers; tests drive `runTick()` directly and never wait on the real interval.

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/background/background-runner.test.ts`. Expected: all pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/background/background-runner.ts src/internal/background/background-runner.test.ts
git commit -m "feat(wallet-sdk): background runner (leader poll + lifecycle state machine + balance listeners)"
```

---

## Task 10: `createBackgroundDomain` — wire the orchestration bundle, forwarder, lock repo, runner

**Files:**
- Create: `packages/wallet-sdk/src/domains/background/background-domain.ts`
- Create: `packages/wallet-sdk/src/domains/background/background-domain.test.ts`

**Interfaces:**
- Produces: `createBackgroundDomain(ctx: DomainContext, accountRepository: AccountRepository): BackgroundDomain` — builds the six repos + six services + five WS managers + six orchestrators + `SparkBalanceListener` + the shared `getCashuAccount`/`getSparkAccount`/`getCashuWalletForMint`/`initiateMelt` helpers, the `WalletChangesForwarder`, the `TaskProcessingLockRepository`, the `TaskLoop`, and the `BackgroundRunner`; returns `{ start, stop, state }` delegating to the runner.

- [ ] **Step 1: Write the test** — `background-domain.test.ts`. A full real-wiring test needs a live connection bundle, so this test asserts (a) the factory builds + returns a `{ start, stop, state }` object whose `state()` is `'stopped'` before start, and (b) `start()` then `stop()` round-trips the state without throwing, using a `ctx` whose `connections` are DI'd fakes sufficient for construction (no network). Build a `fakeConnections()` helper that returns objects with the constructor-required methods stubbed (supabase via `makeFakeDb`, `realtime` with `channel/addChannel/subscribe/removeChannel` no-ops, `cashuWallets`/`sparkWallets`/`mintAuth`/`getCashuSeed`/`cashuCrypto`/`cashuMintValidator` as minimal stubs), and a `config` with `storage` whose `getCurrentUserId` resolves a user.

```ts
import { describe, expect, it } from 'bun:test';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { SdkEventMap } from '../../events';
import { createBackgroundDomain } from './background-domain';
import { makeBackgroundTestCtx } from './background-domain.test-helpers'; // or inline

describe('createBackgroundDomain', () => {
  it('returns a BackgroundDomain that starts in stopped', () => {
    const { ctx, accountRepository } = makeBackgroundTestCtx();
    const background = createBackgroundDomain(ctx, accountRepository);
    expect(background.state()).toBe('stopped');
  });

  it('start() then stop() round-trips to stopped and emits background:state transitions', async () => {
    const { ctx, accountRepository } = makeBackgroundTestCtx();
    const states: string[] = [];
    ctx.emitter.on('background:state', (e) => states.push(e.state));
    const background = createBackgroundDomain(ctx, accountRepository);
    await background.start();
    await background.stop();
    expect(states[0]).toBe('starting');
    expect(states.at(-1)).toBe('stopped');
    expect(background.state()).toBe('stopped');
  });
});
```

> Keep this test focused on construction + lifecycle plumbing; the per-unit behaviour is covered by Tasks 6–9. The fake `ctx.connections.realtime` must implement `channel().on()` chainable + `addChannel`/`subscribe`/`removeChannel`; the fake `config.storage.persistent` must return an `access_token` so `getCurrentUserId` yields a user (or DI a `getUserId` via the storage stub used in S3 tests). If wiring a full fake `ctx` proves heavy, narrow this test to assert `state() === 'stopped'` pre-start and that `createBackgroundDomain` does not throw at construction; lifecycle is then exercised end-to-end in Task 11's `sdk.test.ts`.

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/domains/background/background-domain.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `background-domain.ts`. Build the bundle from `ctx.connections` + `accountRepository`, mirroring how `createCashuDomain`/`createSparkDomain` construct their repos/services. Import the orchestrators + managers + `SparkBalanceListener` by direct path (no barrel).

```ts
import type { Currency } from '@agicash/money';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import { SdkError } from '../../errors';
import type { CashuAccount, SparkAccount } from '../../types/account';
import type { CashuTokenMeltData } from '../../types/cashu';
import { areMintUrlsEqual, toProof, type ExtendedCashuWallet } from '../../internal/lib/cashu';
import type { DomainContext } from '../context';
import type { BackgroundDomain } from '../../domains';
import type { AccountRepository } from '../../internal/repositories/account-repository';

import { CashuSendQuoteRepository } from '../../internal/repositories/cashu-send-quote-repository';
import { CashuSendSwapRepository } from '../../internal/repositories/cashu-send-swap-repository';
import { CashuReceiveQuoteRepository } from '../../internal/repositories/cashu-receive-quote-repository';
import { CashuReceiveSwapRepository } from '../../internal/repositories/cashu-receive-swap-repository';
import { SparkSendQuoteRepository } from '../../internal/repositories/spark-send-quote-repository';
import { SparkReceiveQuoteRepository } from '../../internal/repositories/spark-receive-quote-repository';
import { TransactionRepository } from '../../internal/repositories/transaction-repository';

import { CashuSendQuoteService } from '../cashu/cashu-send-quote-service';
import { CashuSendSwapService } from '../cashu/cashu-send-swap-service';
import { CashuReceiveQuoteService } from '../cashu/cashu-receive-quote-service';
import { CashuReceiveSwapService } from '../cashu/cashu-receive-swap-service';
import { SparkSendQuoteService } from '../spark/spark-send-quote-service';
import { SparkReceiveQuoteService } from '../spark/spark-receive-quote-service';

import { MeltQuoteSubscriptionManager } from '../../internal/lib/cashu/melt-quote-subscription-manager';
import { MintQuoteSubscriptionManager } from '../../internal/lib/cashu/mint-quote-subscription-manager';
import { ProofStateSubscriptionManager } from '../../internal/lib/cashu/proof-state-subscription-manager';

import { CashuSendOrchestrator } from '../../internal/orchestrator/cashu-send-orchestrator';
import { CashuSendSwapOrchestrator } from '../../internal/orchestrator/cashu-send-swap-orchestrator';
import { CashuReceiveQuoteOrchestrator } from '../../internal/orchestrator/cashu-receive-quote-orchestrator';
import { CashuReceiveSwapOrchestrator } from '../../internal/orchestrator/cashu-receive-swap-orchestrator';
import { SparkSendOrchestrator } from '../../internal/orchestrator/spark-send-orchestrator';
import { SparkReceiveOrchestrator } from '../../internal/orchestrator/spark-receive-orchestrator';
import { SparkBalanceListener } from '../../internal/orchestrator/spark-balance-listener';

import { TaskProcessingLockRepository } from '../../internal/background/task-processing-lock-repository';
import { TaskLoop } from '../../internal/background/task-loop';
import { BackgroundRunner } from '../../internal/background/background-runner';
import { WalletChangesForwarder } from '../../internal/realtime/wallet-changes-forwarder';
import { toUser } from '../../internal/db/user-mapper';

export function createBackgroundDomain(
  ctx: DomainContext,
  accountRepository: AccountRepository,
): BackgroundDomain {
  const { config, connections, emitter } = ctx;
  const { supabase, encryption, cashuCrypto, realtime, cashuWallets } = connections;

  const getUserId = () => getCurrentUserId(config.storage);

  // --- account / wallet resolution (online-filtered; D6) ---
  const getCashuAccount = async (id: string): Promise<CashuAccount | null> => {
    const account = await accountRepository.get(id);
    return account && account.type === 'cashu' && account.isOnline ? account : null;
  };
  const getSparkAccount = async (id: string): Promise<SparkAccount | null> => {
    const account = await accountRepository.get(id);
    return account && account.type === 'spark' && account.isOnline ? account : null;
  };
  const getCashuWalletForMint = async (mintUrl: string): Promise<ExtendedCashuWallet> => {
    const userId = await getUserId();
    if (!userId) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    const accounts = await accountRepository.getAllActive(userId);
    const account = accounts.find(
      (a): a is CashuAccount => a.type === 'cashu' && a.isOnline && areMintUrlsEqual(a.mintUrl, mintUrl),
    );
    if (!account) throw new SdkError(`No online cashu account for mint ${mintUrl}`, 'cashu_wallet_unavailable');
    return account.wallet as ExtendedCashuWallet;
  };

  // --- repos ---
  const cashuSendQuoteRepo = new CashuSendQuoteRepository(supabase, encryption);
  const cashuSendSwapRepo = new CashuSendSwapRepository(supabase, encryption);
  const cashuReceiveQuoteRepo = new CashuReceiveQuoteRepository(supabase, encryption, accountRepository);
  const cashuReceiveSwapRepo = new CashuReceiveSwapRepository(supabase, encryption, accountRepository);
  const sparkSendQuoteRepo = new SparkSendQuoteRepository(supabase, encryption);
  const sparkReceiveQuoteRepo = new SparkReceiveQuoteRepository(supabase, encryption);
  const transactionRepo = new TransactionRepository(supabase, encryption);

  // --- services ---
  const cashuSendQuoteService = new CashuSendQuoteService(cashuSendQuoteRepo);
  const cashuReceiveQuoteService = new CashuReceiveQuoteService(cashuCrypto, cashuReceiveQuoteRepo);
  const cashuReceiveSwapService = new CashuReceiveSwapService(cashuReceiveSwapRepo);
  const cashuSendSwapService = new CashuSendSwapService(cashuSendSwapRepo, cashuReceiveSwapService);
  const sparkSendQuoteService = new SparkSendQuoteService(sparkSendQuoteRepo);
  const sparkReceiveQuoteService = new SparkReceiveQuoteService(sparkReceiveQuoteRepo);

  // --- WS managers (separate per orchestrator, matching the web) ---
  const cashuSendMeltMgr = new MeltQuoteSubscriptionManager(getCashuWalletForMint);
  const cashuReceiveMintMgr = new MintQuoteSubscriptionManager(getCashuWalletForMint);
  const cashuReceiveMeltMgr = new MeltQuoteSubscriptionManager(getCashuWalletForMint);
  const proofMgr = new ProofStateSubscriptionManager(getCashuWalletForMint);
  const sparkReceiveMeltMgr = new MeltQuoteSubscriptionManager(getCashuWalletForMint);

  // --- the shared cross-mint melt handler (runs on the SOURCE cashu wallet) ---
  const initiateMelt = async (quote: { tokenReceiveData: CashuTokenMeltData }): Promise<void> => {
    const data = quote.tokenReceiveData;
    const sourceWallet = await getCashuWalletForMint(data.sourceMintUrl);
    await sourceWallet.meltProofsIdempotent(
      { quote: data.meltQuoteId, amount: data.tokenAmount.toNumber(getCashuUnit(data.tokenAmount.currency)) },
      data.tokenProofs.map((p) => toProof(p)),
      undefined,
      { type: 'random' },
    );
  };

  // --- orchestrators ---
  const cashuSend = new CashuSendOrchestrator({ sendQuoteService: cashuSendQuoteService, sendQuoteRepository: cashuSendQuoteRepo, getAccount: getCashuAccount, meltSubscriptionManager: cashuSendMeltMgr, emitter });
  const cashuSendSwap = new CashuSendSwapOrchestrator({ sendSwapService: cashuSendSwapService, getAccount: getCashuAccount, proofStateSubscriptionManager: proofMgr, emitter });
  const cashuReceiveQuote = new CashuReceiveQuoteOrchestrator({ receiveQuoteService: cashuReceiveQuoteService, getAccount: getCashuAccount, mintSubscriptionManager: cashuReceiveMintMgr, meltSubscriptionManager: cashuReceiveMeltMgr, emitter });
  const cashuReceiveSwap = new CashuReceiveSwapOrchestrator({ receiveSwapService: cashuReceiveSwapService, getAccount: getCashuAccount, emitter });
  const sparkSend = new SparkSendOrchestrator({ sendQuoteService: sparkSendQuoteService, getAccount: getSparkAccount, emitter });
  const sparkReceive = new SparkReceiveOrchestrator({ receiveQuoteService: sparkReceiveQuoteService, getAccount: getSparkAccount, meltSubscriptionManager: sparkReceiveMeltMgr, emitter });

  // --- balance listeners (always-on; registered on start) ---
  const balanceListener = new SparkBalanceListener({ emitter });
  const registerBalanceListeners = async (userId: string): Promise<() => void> => {
    const accounts = await accountRepository.getAllActive(userId);
    const sparkAccounts = accounts.filter((a): a is SparkAccount => a.type === 'spark' && a.isOnline);
    const cleanups = await Promise.all(sparkAccounts.map((a) => balanceListener.register(a)));
    return () => cleanups.forEach((c) => c());
  };

  // --- forwarder / lock / loop / runner ---
  const forwarder = new WalletChangesForwarder({ realtime, emitter, transactionRepository: transactionRepo, accountRepository, toUser });
  const lockRepository = new TaskProcessingLockRepository(supabase);
  const taskLoop = new TaskLoop({
    repos: {
      cashuSendQuote: cashuSendQuoteRepo,
      cashuSendSwap: cashuSendSwapRepo,
      cashuReceiveQuote: cashuReceiveQuoteRepo,
      cashuReceiveSwap: cashuReceiveSwapRepo,
      sparkSendQuote: sparkSendQuoteRepo,
      sparkReceiveQuote: sparkReceiveQuoteRepo,
    },
    orchestrators: { cashuSend, cashuSendSwap, cashuReceiveQuote, cashuReceiveSwap, sparkSend, sparkReceive },
    cashuReceiveQuoteService,
    cashuSendQuoteService,
    initiateMelt,
    getUserId,
    emitter,
  });

  const runner = new BackgroundRunner({
    lockRepository,
    taskLoop,
    forwarder,
    registerBalanceListeners,
    getUserId,
    clientId: config.clientId ?? crypto.randomUUID(),
    emitter,
  });

  return {
    start: () => runner.start(),
    stop: () => runner.stop(),
    state: () => runner.state(),
  };
}

// getCashuUnit: protocol unit for a currency (e.g. 'sat' for BTC, 'usd'/'cent' for USD)
import { getCashuUnit } from '../../internal/lib/cashu/utils';
```

> Verify before writing: (a) the exact ctor signatures of each repo/service/orchestrator (Tasks above + reports) — especially `CashuReceiveQuoteService(cashuCrypto, repo)` and `CashuSendSwapService(sendSwapRepo, receiveSwapService)`. (b) `initiateMelt`'s melt-amount derivation: confirm `CashuTokenMeltData.tokenAmount` is a `Money` and the right unit (`getCashuUnit(currency)` from `internal/lib/cashu/utils.ts:57`); confirm `meltProofsIdempotent` accepts `data.tokenProofs.map(toProof)` (the proofs may already be the right shape — match `claim-cashu-token-service.ts:55-63`). (c) `areMintUrlsEqual`/`toProof`/`ExtendedCashuWallet` are exported from `internal/lib/cashu` (barrel). (d) the `initiateMelt` `{ tokenReceiveData }` param is structurally assignable to both the cashu (`CashuReceiveQuote & { type:'CASHU_TOKEN' }`) and spark (`SparkReceiveQuote & { type:'CASHU_TOKEN' }`) handler types (function-param contravariance — it is). (e) `CashuReceiveSwapOrchestrator` ctor does NOT take a subscription manager.

- [ ] **Step 4: Run it; expect PASS** — `bun test src/domains/background/background-domain.test.ts`. Expected: pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/domains/background/
git commit -m "feat(wallet-sdk): createBackgroundDomain wiring (orchestration bundle + forwarder + leader runner)"
```

---

## Task 11: Wire `background` into `sdk.ts`

**Files:**
- Modify: `packages/wallet-sdk/src/sdk.ts`
- Modify: `packages/wallet-sdk/src/sdk.test.ts`

**Interfaces:**
- Produces: `Sdk.background` is the real domain — `sdk.background.state() === 'stopped'` before start; `start()`/`stop()` drive `background:state` events. The `notImplementedDomain<BackgroundDomain>('background')` initializer is removed.

- [ ] **Step 1: Write the failing test** — append to `sdk.test.ts` (follow the file's existing `Sdk.create` / fake-config harness):

```ts
describe('Sdk.background', () => {
  it('is a real domain (state() is stopped before start, not a NotImplementedError throw)', async () => {
    const sdk = await Sdk.create(testConfig());
    expect(sdk.background.state()).toBe('stopped');
  });
});
```

> Use the same `testConfig()` the rest of `sdk.test.ts` uses to construct an `Sdk` without network (the connections are built but nothing connects until a domain method runs). If `Sdk.create` requires more config than before because of the wiring, supply the minimal additions in `testConfig()`.

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/sdk.test.ts -t "background"`. Expected: FAIL (calling `state()` on the `notImplementedDomain` Proxy throws `NotImplementedError`).

- [ ] **Step 3: Implement** — in `sdk.ts`:
  1. Change the field declaration `sdk.ts:66-67` from the class-field initializer to a bare declaration: `readonly background: BackgroundDomain;`.
  2. In the constructor (after `accountRepository` is built, alongside the other domain assignments), add: `this.background = createBackgroundDomain(ctx, accountRepository);`.
  3. Add the import: `import { createBackgroundDomain } from './domains/background/background-domain';`.
  4. Remove the now-unused `notImplementedDomain` import **only if** no other domain still uses it (grep first — all 11 domains are now real, so it is likely fully unused; delete the import and the `internal/not-implemented` file only if nothing else references them — otherwise leave them).

- [ ] **Step 4: Run it; expect PASS** — `bun test src/sdk.test.ts`. Expected: all pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/sdk.ts src/sdk.test.ts
git commit -m "feat(wallet-sdk): wire background domain into Sdk (all 11 domains now live)"
```

---

## Task 12: Whole-slice verification gate + live-confirmation + docs/memory

**Files:** docs only (+ the plan-of-plans index).

- [ ] **Step 1: Full SDK gate** — from `packages/wallet-sdk/`:

```bash
bun run typecheck && bun run test
```
Expected: green; SDK test count = the prior 570 + the tests added here. Confirm no failures and the count rose only by the new tests.

- [ ] **Step 2: Confirm the dark stubs are gone + background is live** — none of these should still throw `NotImplementedError`:

```bash
git grep -n "NotImplementedError('cashu.send.executeQuote')" src/ || echo "OK: cashu send executeQuote wired"
git grep -n "NotImplementedError('cashu.receive.receiveToken')" src/ || echo "OK: cashu receiveToken wired"
git grep -n "NotImplementedError('spark.send.executeQuote')" src/ || echo "OK: spark send executeQuote wired"
git grep -n "notImplementedDomain<BackgroundDomain>" src/sdk.ts || echo "OK: background is a real domain"
git status --short   # clean
```

- [ ] **Step 3: Confirm nothing starts background in production** — the SDK builds + tests the background but never calls `start()` outside tests (the web does that in S13):

```bash
git grep -n "\.background\.start()" src/ | grep -v ".test.ts" || echo "OK: background.start only called from tests"
```
Expected: no non-test call site. (The web is untouched on this branch.)

- [ ] **Step 4: Update the plan-of-plans index** — flip the Plan 09 row to ✅ done with a one-line summary + the S9→S10/S11 carryover (see below), and update the `project-wallet-sdk-nocache-track` memory (Plans 01–09 done; next = S10 `ServerSdk`).

```bash
git add docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md docs/superpowers/plans/2026-06-13-wallet-sdk-09-background.md
git commit -m "docs(wallet-sdk): record Plan 09 (background + forwarder + executeQuote/receiveToken wiring) done + S10/S11 carryover"
```

**Carryover to record (S9 → S10 / S11):**
- **(S11 web cut-over)** `background.start()` is called on sign-in / `stop()` on sign-out (the auth lifecycle); the web deletes its `TaskProcessor` + `useTakeTaskProcessingLead` + `useTrackWalletChanges` + all `*ChangeHandlers` in the SAME S13 step (avoids dual leaders / dual realtime — spec §8). The web must supply `config.clientId` (stable per client) or accept the SDK's per-instance `crypto.randomUUID()`.
- **(S11)** The realtime forwarder drives `transaction:*` / `account:updated` / `user:updated` only. Contacts are owned by the synchronous S8 emits; the web's `useSdkEventBridge` must map `contact:created`/`:deleted` from those (cross-device contact sync relies on the kept `refetchOnReconnect`/`refetchOnWindowFocus`).
- **(known limitation)** `stop()` halts the poll + forwarder + spark listeners but does NOT proactively close cashu-ts WS sockets (the orchestrators discard the managers' unsubscribe thunks; the managers self-clean on socket close + dedupe on the next start). Acceptable; documented in D7.
- **(S10 ServerSdk)** `ServerSdk` has no background loop (server mode is request-scoped, no leader election, no realtime forwarder). It reuses the shared services/repos but NOT `createBackgroundDomain`.
- **(follow-up, non-blocking)** `executeQuote` foreground vs background double-initiate is guarded by `meltProofsIdempotent` + service state-guards; if a tighter guarantee is wanted, S11 could have the UI rely solely on the background loop for the kick (skip `executeQuote`) — decide during the web cut-over.

---

## Self-Review

**1. Spec coverage (§7b background row + §9 S9 + §5 bridge + §8 + D10):**
- Leader election (`take_lead` repo + 5s poll + 6s TTL semantics) → Tasks 2, 9. ✓
- Realtime DB-event → SDK-event forwarder (the §5 bridge source for transaction/account/user) → Task 6; contacts double-drive avoided (D2; the §8/Plan-08 carryover) ✓
- The leader-elected poll loop driving all six orchestrators + quote-expiry → Tasks 7, 8 ✓
- Wiring the dark `cashu.send.executeQuote` / `spark.send.executeQuote` / `cashu.receive.receiveToken` → Tasks 3, 4, 5 ✓
- `createSparkDomain` gains `accountRepository` (07b carryover) → Task 4 ✓
- Deferred 07a M1 double-emit fixed (the carryover-mandated `triggered`-Set port) → Task 1 ✓
- `background.start/stop` are auth-lifecycle only, no connectivity seam (D10) → Task 9 (no connectivity API) ✓
- Offline spark accounts guarded (07b carryover (c)) + online-account filter (web `useSelectItemsWithOnlineAccount`) → D6's `getCashuAccount`/`getSparkAccount` returning null ✓
- User-row bootstrap retry (Plan-03 carryover) → D5 (the 5s `take_lead` retry absorbs it) ✓
- `background` assembled into `sdk.ts` (the only remaining `notImplementedDomain`) → Task 11 ✓
- Verified by SDK unit tests alone; the web untouched; background unstarted in production until S13 (§8/§9) → Task 12 ✓

**2. Placeholder scan:** every code step shows full code; commands have expected output. The `>`-prefixed notes are *verification reminders* (confirm an existing signature/shape before writing — e.g. `processDrafts` filtering, `initiateMelt` amount derivation, the `getDecodedToken` arity, the broadcast callback param), not deferred work. No "TBD"/"add error handling"/"similar to Task N".

**3. Type consistency:** orchestrator deps objects + per-tick entry points match the verified S7 shapes (`reconcile` void for cashu / `() => void` thunk for spark; `reconcileCrossMintMelts(quotes, { initiateMelt })`). Service calls match S5/S6: `initiateSend(account, sendQuote, meltQuote)` (cashu, then `markSendQuoteAsPending`) vs `initiateSend({account, sendQuote})` (spark, returns PENDING); `expire`/`expireSendQuote` return `void` (loop gates via try/catch + state filter); `claimToken({userId, token, sourceAccount, destinationAccount})`. Event payloads match `SdkEventMap` (`send:pending {quoteId, transactionId, protocol}`, `receive:expired {quoteId, protocol}`, `account:updated {account, op}`, `background:state {state}`). Errors `(message, code)` / `NotImplementedError(method)`. `BackgroundState` union + sync `state()`. `take_lead(p_user_id, p_client_id) → boolean`. Forwarder maps the broadcast `payload` directly via `toTransaction`/`toAccount`/`toUser`.

**Risks / carryover to S10/S11:** recorded in Task 12. The biggest is the leader/follower split for active-flow live state (a follower's orchestrators don't emit `send:*`/`receive:*`; the leader drives the row → `transaction:*` reaches all clients via the forwarder) — a §5/S13 concern, not S9.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-09-background.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, two-stage review between tasks, gate = `bun run typecheck` + `bun run test`. (REQUIRED SUB-SKILL: superpowers:subagent-driven-development.)
2. **Inline Execution** — execute tasks in this session via superpowers:executing-plans, batch execution with checkpoints.
