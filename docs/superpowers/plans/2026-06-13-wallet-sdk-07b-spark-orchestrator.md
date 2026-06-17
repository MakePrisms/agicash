# Wallet SDK — S7b: Spark Orchestrator Primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and unit-test (offline) every **spark** orchestration *building block* the SDK needs — the §8 stale-balance `SparkBalanceListener`, the `SparkSendOrchestrator` (Breez payment-event → complete/fail + the UNPAID→PENDING kick), and the `SparkReceiveOrchestrator` (Breez payment-event → complete, `synced`→expiry, and the CASHU_TOKEN cross-mint melt completion that reuses 07a's `MeltQuoteSubscriptionManager`) — leaving the public `spark.send.executeQuote` entry point stubbed for S9 to wire.

**Architecture:** S7 is split (owner's call) into **07a (cashu, done)** and **07b (spark, this plan)**. Per the owner's S7/S9 decision, S7 builds *primitives only*: standalone, DI-driven classes in `internal/orchestrator/`, each unit-tested with injected fakes and synthetic events (no live Breez / WS). **S9** later assembles them into the leader-elected 5s poll loop, makes `executeQuote` real, and owns subscription/listener lifecycle + quote-expiry driving. Consequently the spark orchestrator classes here are **"dark"**: present and fully tested, but **not yet imported by `createSparkDomain`** (the `NotImplementedError` stub stays). This mirrors 07a's build-dark methodology exactly (each slice verified by SDK unit tests alone).

Where cashu orchestrators react to a *WS subscription manager*, spark send/receive orchestrators react to **per-account Breez `SdkEvent`s** delivered through the live `BreezSdk` handle on `account.wallet` (DI'd as a fake whose `addEventListener` captures `onEvent` + has a controllable `getInfo`/`getPayment`/`getPaymentByInvoice`). The one exception is the CASHU_TOKEN cross-mint melt sub-flow, whose source-mint melt is a *cashu* melt monitored via the existing `MeltQuoteSubscriptionManager` (built in 07a, reused verbatim).

**Tech Stack:** TypeScript, `bun test` (+ `bun:test` `mock`/`spyOn`), `@agicash/breez-sdk-spark` (`BreezSdk`/`SdkEvent`/`Payment`), `@cashu/cashu-ts@3.6.1` (`MeltQuoteState`/`MeltQuoteBolt11Response`), `@agicash/money`, the SDK's `SdkEventEmitter`. Package manager: `bun`/`bunx` only. CI gate per task: `bun run typecheck` + `bun run test` (NOT `fix:all`).

## Global Constraints

- `SdkError`/`DomainError` take **`(message, code)`**; `NotImplementedError` takes **`(method)`**. Every ported throw needs a `code`.
- **Never** use bare `mock.module` (process-global; leaked into 100+ sibling tests in S3/S5). Use **DI'd fakes** (every orchestrator takes its deps via a constructor `deps` object) + a **real `SdkEventEmitter`** to assert emissions. `spyOn` + `afterEach/afterAll(() => mock.restore())` only if a real prototype must be redirected (not needed here).
- Emit SDK events **only on a real state transition** — gate the emit on the returned entity state where the service returns a quote (`complete`/`fail` on send; `complete` on receive), and dedupe repeated event deliveries with a per-`reconcile` `triggered: Set<string>` for the void-returning paths (`receive.expire`, `receive.fail`). This is how 07b proactively closes the M1-class double-emit that 07a deferred (see Decision D4).
- Per-task gate: `bun run typecheck` + `bun run test` (run from `packages/wallet-sdk/`). One git commit per task, message `feat(wallet-sdk): …`.
- **Dark build:** do NOT import these units into `createSparkDomain`; do NOT touch `sdk.ts`; `spark.send.executeQuote` stays `throw new NotImplementedError('spark.send.executeQuote')`.
- The §8 spark `synced` stale-balance regression test is **mandatory** (the spark analogue of 07a's nutshell-#788 Task 6) and is owned by Task 1.

---

## Background facts (verified against current code — do not re-derive)

### Breez handle (`account.wallet` is a live `BreezSdk`)

`SparkAccount` (`src/types/account.ts`, `SparkAccount = Extract<Account, { type: 'spark' }>`) carries `wallet: BreezSdk`. The `BreezSdk` methods used here (verified in `node_modules/@agicash/breez-sdk-spark/web/breez_sdk_spark_wasm.d.ts`):

```ts
addEventListener(listener: { onEvent: (e: SdkEvent) => void }): Promise<string>; // returns a listener-id
removeEventListener(id: string): Promise<boolean>;
getInfo(request: {}): Promise<{ identityPubkey: string; balanceSats: number; tokenBalances: Map<…> }>; // call as getInfo({})
getPayment(request: { paymentId: string }): Promise<{ payment: Payment }>;          // payment REQUIRED
getPaymentByInvoice(request: { invoice: string }): Promise<{ payment?: Payment }>;  // payment OPTIONAL
```

`SdkEvent` (Breez native union — **not** the SDK's own event bus):

```ts
type SdkEvent =
  | { type: 'synced' }
  | { type: 'unclaimedDeposits'; unclaimedDeposits: DepositInfo[] }
  | { type: 'claimedDeposits'; claimedDeposits: DepositInfo[] }
  | { type: 'paymentSucceeded'; payment: Payment }
  | { type: 'paymentPending'; payment: Payment }
  | { type: 'paymentFailed'; payment: Payment }
  | { type: 'optimization'; optimizationEvent: OptimizationEvent }
  | { type: 'lightningAddressChanged'; lightningAddress?: LightningAddressInfo }
  | { type: 'newDeposits'; newDeposits: DepositInfo[] };
```

`Payment` (relevant fields):

```ts
interface Payment { id: string; status: 'completed' | 'pending' | 'failed'; amount: bigint; fees: bigint; details?: PaymentDetails; … }
// preimage + paymentHash live ONLY under the 'lightning' details variant:
//   payment.details?.type === 'lightning'  ⇒  payment.details.htlcDetails: { paymentHash: string; preimage?: string; … }
```

**Critical:** there is **no** `sparkTransferId` field on `Payment` — the transfer id **is `payment.id`**. `preimage` is `string | undefined` (only present once the HTLC reaches `preimageShared`); both handlers must `console.error` + return without completing when it is missing. `details` is optional and a discriminated union — narrow on `details.type === 'lightning'` before touching `htlcDetails`.

### Imports (exact, from `src/internal/orchestrator/`)

```ts
import type { Payment, SdkEvent } from '@agicash/breez-sdk-spark';
import { type MeltQuoteBolt11Response, MeltQuoteState } from '@cashu/cashu-ts';
import { Money } from '@agicash/money';
import { DomainError, SdkError } from '../../errors';
import type { SdkEventMap } from '../../events';
import type { SdkEventEmitter } from '../event-emitter';
import type { Account, SparkAccount } from '../../types/account';
import type { SparkSendQuote, SparkReceiveQuote } from '../../types/spark';
import type { SparkSendQuoteService } from '../../domains/spark/spark-send-quote-service';
import type { SparkReceiveQuoteService } from '../../domains/spark/spark-receive-quote-service';
import type { MeltQuoteSubscriptionManager } from '../lib/cashu/melt-quote-subscription-manager';
```

(`import { type BreezSdk, type SdkEvent } from '@agicash/breez-sdk-spark'` is already used by `web-wallet/.../spark.ts`; `import type { Payment } from '@agicash/breez-sdk-spark'` by `claim-cashu-token-service.ts` — both resolve.) The orchestrators do **not** import `BreezSdk` directly; they reach it through `SparkAccount.wallet`.

### Spark domain services the orchestrators call (verified signatures)

`SparkSendQuoteService` (`src/domains/spark/spark-send-quote-service.ts`):
```ts
initiateSend(params: { account: SparkAccount; sendQuote: SparkSendQuote }): Promise<SparkSendQuote>; // OBJECT param. UNPAID→PENDING; idempotent (returns as-is if PENDING); throws DomainError 'invalid_state'|'fee_changed'|'already_paid'|'insufficient_balance'
complete(quote: SparkSendQuote, paymentPreimage: string): Promise<SparkSendQuote>;   // POSITIONAL. PENDING→COMPLETED; no-op if COMPLETED; throws 'invalid_state' if not PENDING
fail(quote: SparkSendQuote, reason: string): Promise<SparkSendQuote>;                 // POSITIONAL. →FAILED; no-op if FAILED; throws if not (PENDING|UNPAID). RETURNS the quote
get(quoteId: string): Promise<SparkSendQuote | null>;
```

`SparkReceiveQuoteService` (`src/domains/spark/spark-receive-quote-service.ts`):
```ts
complete(quote: SparkReceiveQuote, paymentPreimage: string, sparkTransferId: string): Promise<SparkReceiveQuote>; // POSITIONAL 3-arg. UNPAID→PAID; no-op if PAID; throws if not UNPAID
expire(quote: SparkReceiveQuote): Promise<void>;          // UNPAID→EXPIRED; no-op if EXPIRED; throws if not UNPAID; throws if expiresAt > now. RETURNS void
fail(quote: SparkReceiveQuote, reason: string): Promise<void>;  // UNPAID→FAILED; no-op if FAILED; throws if not UNPAID. RETURNS void
markMeltInitiated(quote: SparkReceiveQuote & { type: 'CASHU_TOKEN' }): Promise<SparkReceiveQuote & { type: 'CASHU_TOKEN' }>; // sets meltInitiated; no-op if already; throws if not UNPAID
get(quoteId: string): Promise<SparkReceiveQuote | null>;
```

**Argument-convention asymmetry (do not "normalize"):** `initiateSend` takes an object; `complete`/`fail` are positional. **Return-type asymmetry:** send `complete`/`fail` return the quote (gate the emit on `.state`); receive `expire`/`fail` return `void` (gate via the `triggered` set).

### Entity types (`src/types/spark.ts`)

```ts
type SparkSendQuote = Base & (
  | { state: 'UNPAID' }
  | { state: 'PENDING';   sparkId; sparkTransferId: string; fee: Money }
  | { state: 'COMPLETED'; sparkId; sparkTransferId: string; fee: Money; paymentPreimage: string }
  | { state: 'FAILED';    failureReason: string; sparkId?; sparkTransferId?; fee? }
);
// Base has: id, amount: Money, transactionId, accountId, expiresAt?: string | null, paymentHash, paymentRequest, …

type SparkReceiveQuote = Base
  & ({ type: 'LIGHTNING' } | { type: 'CASHU_TOKEN'; tokenReceiveData: CashuTokenMeltData })
  & ({ state: 'UNPAID' | 'EXPIRED' } | { state: 'PAID'; paymentPreimage; sparkTransferId } | { state: 'FAILED'; failureReason });
// Base has: id, amount: Money, transactionId, accountId, expiresAt: string (non-null), paymentHash, paymentRequest, …
// CashuTokenMeltData: { sourceMintUrl: string; meltQuoteId: string; meltInitiated: boolean; tokenAmount; tokenProofs; cashuReceiveFee; lightningFeeReserve; lightningFee? }
```

Send completion keys on **`payment.id` ↔ `quote.sparkTransferId`** (PENDING quotes have `sparkTransferId`). Receive completion keys on **`details.htlcDetails.paymentHash` ↔ `quote.paymentHash`** and passes `sparkTransferId = payment.id` to `complete`.

### SDK event payloads (`src/events.ts`) — `protocol` is always `'spark'` here

```ts
'send:pending':     { quoteId: string; transactionId: string; protocol }
'send:completed':   { quoteId: string; transactionId: string; amount: Money; protocol }
'send:failed':      { quoteId: string; error: SdkError; protocol }   // NO transactionId
'receive:completed':{ quoteId: string; transactionId: string; amount: Money; protocol }
'receive:expired':  { quoteId: string; protocol }                    // NO transactionId / amount
'receive:failed':   { quoteId: string; error: SdkError; protocol }
'account:updated':  { account: Account; op: 'created' | 'updated' }  // op only 'created'|'updated'
```

`SdkEventEmitter` (`src/internal/event-emitter.ts`): `emit(event, data)`, `on(event, handler) => () => void`. Tests construct a real `new SdkEventEmitter<SdkEventMap>()` and `.on(...)` to capture emissions.

### `MeltQuoteSubscriptionManager` (07a, reused verbatim — `src/internal/lib/cashu/melt-quote-subscription-manager.ts`)

```ts
class MeltQuoteSubscriptionManager {
  constructor(getWallet: (mintUrl: string) => Promise<ExtendedCashuWallet>) {}
  subscribe(args: { mintUrl: string; quoteIds: string[]; onUpdate: (meltQuoteResponse: MeltQuoteBolt11Response) => void }): Promise<() => void>;
  removeQuoteFromSubscription(args: { mintUrl: string; quoteId: string }): void;
}
```
07b only *consumes* it (DI'd into `SparkReceiveOrchestrator.deps`). It is not re-ported or modified.

### 07a precedent to mirror (`src/internal/orchestrator/cashu-*-orchestrator.ts`)

- Class shape: `export class X { constructor(private readonly deps: XDeps) {} }`, `export type XDeps = { …services…; getAccount: (accountId: string) => Promise<SparkAccount | null>; …subscriptionManager?…; emitter: SdkEventEmitter<SdkEventMap> }`.
- Three-layer split: pure `applyXxxState(...)` (guards on local state, calls the service, emits on real transition) + `reconcile(...)` (groups, subscribes/registers, routes via the fire-and-forget pattern) + the routing closure.
- Fire-and-forget from a sync callback: `void this.handler(...).catch((error) => console.error('<context msg>', { cause: error }))`.
- No lifecycle methods on the orchestrator (no `start`/`stop`/run-loop) — S9 owns cadence. **Difference for spark:** because spark uses raw `addEventListener` (not a self-cleaning subscription manager), 07b's `reconcile` **returns a `() => void` cleanup** that detaches the listeners it attached. S9 calls it before the next reconcile and on stop.
- `internal/orchestrator/` has **no `index.ts` barrel** — cashu orchestrators are imported by direct path. Spark units do the same: a unit is kept "live" by being `export`ed + imported by its `.test.ts`. No barrel task.
- Tests: real `SdkEventEmitter`, `bun:test` `mock()` for every service, hand-built `… as unknown as SparkAccount` fixtures, capture the `onEvent` callback from a fake `addEventListener`, deliver synthetic events, then `await flush()` (`new Promise((r) => setTimeout(r, 0))`) before asserting on the captured events array + mock call counts.

---

## Decisions (forks resolved before writing — carry, do not re-litigate)

- **D1 — Listener topology: three separate per-concern units, each registering its own Breez listener.** Not a single fan-out registration. Rationale: mirrors the web's three independent hooks (`useTrackAndUpdateSparkAccountBalances`, `useOnSparkSendStateChange`, `useOnSparkReceiveStateChange`); matches 07a's self-contained-orchestrator pattern; keeps the §8 balance regression in a clean single-responsibility unit. Breez permits multiple `addEventListener`s per wallet (each returns a distinct id), and the web already attaches three. If S9 later wants one shared wallet listener it can fan out at the wiring layer; the *primitives* stay independent.
- **D2 — `SparkBalanceListener` is a standalone per-`(wallet, account)` unit** (not folded into the receive orchestrator). Single responsibility + a clean, isolated §8 regression test.
- **D3 — `createSparkDomain(ctx)` stays UNTOUCHED.** It currently takes `ctx` only (no `accountRepository`). `spark.send.executeQuote` stays `NotImplementedError`. S9 adds the `accountRepository` param when it wires `executeQuote` (which must resolve `account` from `quote.accountId`) + the poll loop. 07b builds units standalone.
- **D4 — 07b proactively closes the M1-class double-emit (07a deferred it).** Repeated/duplicate event deliveries (the listener firing `paymentSucceeded` *and* the initial `getPayment` recovery returning `completed`; repeated `synced`; repeated source-melt `UNPAID`) are deduped by a per-`reconcile` `triggered: Set<string>` keyed `${quoteId}:${terminalMarker}`. This is the legitimate "gate the emit on a real transition" fix for the void-returning `receive.expire`/`receive.fail`, without touching S6 services. Cross-tick retries stay possible because each `reconcile` builds a fresh snapshot + fresh `triggered` set from S9's `getUnresolved`/`getPending`.

---

## File Structure

```
packages/wallet-sdk/src/internal/orchestrator/
  spark-balance-listener.ts         (Task 1, new)   — §8 stale-balance listener; emits account:updated
  spark-balance-listener.test.ts    (Task 1, new)   — §8 regression
  spark-send-orchestrator.ts        (Tasks 2–3, new)— applyPaymentEvent + initiateSend (T2); reconcile (T3)
  spark-send-orchestrator.test.ts   (Tasks 2–3, new)
  spark-receive-orchestrator.ts     (Tasks 4–6, new)— applyPaymentSucceeded + applyExpiry (T4); reconcile (T5); cross-mint melt (T6)
  spark-receive-orchestrator.test.ts(Tasks 4–6, new)
```

**Untouched (S9 wires):** `src/domains/spark/spark-domain.ts` (`executeQuote` keeps `throw new NotImplementedError('spark.send.executeQuote')`), `src/sdk.ts`, the S6 spark services/repositories, `MeltQuoteSubscriptionManager`.

---

## Task 1: `SparkBalanceListener` (§8 stale-balance regression — MANDATED)

**Files:**
- Create: `packages/wallet-sdk/src/internal/orchestrator/spark-balance-listener.ts`
- Test: `packages/wallet-sdk/src/internal/orchestrator/spark-balance-listener.test.ts`

**Interfaces:**
- Produces: `SparkBalanceListener` with `constructor(deps: { emitter: SdkEventEmitter<SdkEventMap> })` and `register(account: SparkAccount): Promise<() => void>` (attaches a Breez listener that re-reads `getInfo()` on `synced`/`paymentSucceeded`/`paymentPending`/`paymentFailed`/`claimedDeposits` and emits `account:updated {op:'updated'}` only when `balanceSats` changed; the returned thunk detaches it).

- [ ] **Step 1: Write the failing test** — `spark-balance-listener.test.ts`

```ts
import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import type { SdkEvent } from '@agicash/breez-sdk-spark';
import { SdkEventEmitter } from '../event-emitter';
import type { SdkEventMap } from '../../events';
import type { Account, SparkAccount } from '../../types/account';
import { SparkBalanceListener } from './spark-balance-listener';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sats = (n: number) => new Money({ amount: n, currency: 'BTC', unit: 'sat' }) as Money;

function makeFakeWallet(initialSats: number) {
  let onEvent: ((e: SdkEvent) => void) | undefined;
  const state = { balanceSats: initialSats };
  const removeEventListener = mock(async () => true);
  const wallet = {
    addEventListener: mock(async (l: { onEvent: (e: SdkEvent) => void }) => {
      onEvent = l.onEvent;
      return 'listener-1';
    }),
    removeEventListener,
    getInfo: mock(async () => ({ balanceSats: state.balanceSats })),
  } as unknown as SparkAccount['wallet'];
  return {
    wallet,
    removeEventListener,
    fire: (e: SdkEvent) => onEvent?.(e),
    setBalance: (n: number) => {
      state.balanceSats = n;
    },
  };
}

function sparkAccount(wallet: SparkAccount['wallet'], balanceSats: number): SparkAccount {
  return {
    id: 'acc-1',
    type: 'spark',
    currency: 'BTC',
    balance: sats(balanceSats),
    wallet,
  } as unknown as SparkAccount;
}

function setup(initialSats = 1000) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const events: { account: Account; op: string }[] = [];
  emitter.on('account:updated', (e) => events.push(e));
  const fake = makeFakeWallet(initialSats);
  const account = sparkAccount(fake.wallet, initialSats);
  const listener = new SparkBalanceListener({ emitter });
  return { emitter, events, fake, account, listener };
}

describe('SparkBalanceListener', () => {
  it('§8 REGRESSION: re-reads getInfo() on `synced` and emits the settled balance after a stale paymentSucceeded', async () => {
    const { events, fake, account, listener } = setup(1000);
    await listener.register(account);

    // paymentSucceeded fires but Breez still returns the stale pre-payment balance (the race)
    fake.setBalance(1000);
    fake.fire({ type: 'paymentSucceeded' } as unknown as SdkEvent);
    await flush();
    expect(events).toHaveLength(0); // unchanged → compare-before-emit suppresses

    // synced fires after the wallet settles; getInfo() now returns the post-payment balance
    fake.setBalance(1500);
    fake.fire({ type: 'synced' });
    await flush();
    expect(events).toHaveLength(1);
    expect(events[0]?.op).toBe('updated');
    expect((events[0]?.account as SparkAccount).balance?.toNumber('sat')).toBe(1500);
  });

  it('compare-before-emit suppresses a no-op `synced` re-read (balance unchanged)', async () => {
    const { events, fake, account, listener } = setup(1000);
    await listener.register(account);
    fake.setBalance(1000); // unchanged
    fake.fire({ type: 'synced' });
    await flush();
    expect(events).toHaveLength(0);
  });

  it('emits on a paymentSucceeded that does change the balance', async () => {
    const { events, fake, account, listener } = setup(1000);
    await listener.register(account);
    fake.setBalance(900);
    fake.fire({ type: 'paymentSucceeded' } as unknown as SdkEvent);
    await flush();
    expect(events).toHaveLength(1);
    expect((events[0]?.account as SparkAccount).balance?.toNumber('sat')).toBe(900);
  });

  it('ignores non-balance events (e.g. lightningAddressChanged)', async () => {
    const { events, fake, account, listener } = setup(1000);
    await listener.register(account);
    fake.setBalance(2000);
    fake.fire({ type: 'lightningAddressChanged' } as unknown as SdkEvent);
    await flush();
    expect(events).toHaveLength(0);
  });

  it('cleanup detaches the Breez listener', async () => {
    const { fake, account, listener } = setup(1000);
    const cleanup = await listener.register(account);
    cleanup();
    await flush();
    expect(fake.removeEventListener).toHaveBeenCalledWith('listener-1');
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/orchestrator/spark-balance-listener.test.ts`. Expected: FAIL (`Cannot find module './spark-balance-listener'`).

- [ ] **Step 3: Implement** — `spark-balance-listener.ts`

```ts
import type { SdkEvent } from '@agicash/breez-sdk-spark';
import { Money } from '@agicash/money';
import type { SdkEventMap } from '../../events';
import type { Account, SparkAccount } from '../../types/account';
import type { SdkEventEmitter } from '../event-emitter';

export type SparkBalanceListenerDeps = {
  emitter: SdkEventEmitter<SdkEventMap>;
};

/**
 * Re-reads the Spark wallet balance on balance-affecting Breez events and emits
 * `account:updated` only when `balanceSats` actually changed (compare-before-emit).
 *
 * The `synced` re-read is the §8 stale-balance fix: `paymentSucceeded` can fire
 * before Breez has synced the post-payment balance, so `getInfo()` would return a
 * stale (pre-payment) value; the later `synced` event re-reads the settled balance.
 */
export class SparkBalanceListener {
  private readonly lastEmittedSats = new Map<string, number>();

  constructor(private readonly deps: SparkBalanceListenerDeps) {}

  async register(account: SparkAccount): Promise<() => void> {
    this.lastEmittedSats.set(
      account.id,
      (account.balance ?? Money.zero(account.currency)).toNumber('sat'),
    );

    const listenerPromise = account.wallet.addEventListener({
      onEvent: (event: SdkEvent) => {
        if (
          event.type === 'synced' ||
          event.type === 'paymentSucceeded' ||
          event.type === 'paymentPending' ||
          event.type === 'paymentFailed' ||
          event.type === 'claimedDeposits'
        ) {
          void this.refreshBalance(account).catch((error) =>
            console.error('spark balance refresh failed', {
              accountId: account.id,
              cause: error,
            }),
          );
        }
      },
    });

    return () => {
      void listenerPromise
        .then((id) => account.wallet.removeEventListener(id))
        .catch(() =>
          console.warn('Failed to remove Spark balance listener', {
            accountId: account.id,
          }),
        );
    };
  }

  private async refreshBalance(account: SparkAccount): Promise<void> {
    const info = await account.wallet.getInfo({});
    if (this.lastEmittedSats.get(account.id) === info.balanceSats) return;
    this.lastEmittedSats.set(account.id, info.balanceSats);
    const balance = new Money({
      amount: info.balanceSats,
      currency: 'BTC',
      unit: 'sat',
    }) as Money;
    const updated: Account = { ...account, balance };
    this.deps.emitter.emit('account:updated', { account: updated, op: 'updated' });
  }
}
```

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/orchestrator/spark-balance-listener.test.ts`. Expected: 5 pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/orchestrator/spark-balance-listener.ts src/internal/orchestrator/spark-balance-listener.test.ts
git commit -m "feat(wallet-sdk): spark balance listener with §8 synced stale-balance regression"
```

---

## Task 2: `SparkSendOrchestrator` — `applyPaymentEvent` + `initiateSend` (pure transitions)

**Files:**
- Create: `packages/wallet-sdk/src/internal/orchestrator/spark-send-orchestrator.ts`
- Test: `packages/wallet-sdk/src/internal/orchestrator/spark-send-orchestrator.test.ts`

**Interfaces:**
- Consumes: `SparkSendQuoteService.initiateSend({account, sendQuote})` / `.complete(quote, preimage)` / `.fail(quote, reason)`.
- Produces:
  - `type SparkSendOrchestratorDeps = { sendQuoteService: SparkSendQuoteService; getAccount: (accountId: string) => Promise<SparkAccount | null>; emitter: SdkEventEmitter<SdkEventMap> }`
  - `class SparkSendOrchestrator` with `initiateSend(account: SparkAccount, sendQuote: SparkSendQuote): Promise<void>` (UNPAID kick → `send:pending`; DomainError → fail + `send:failed`) and `applyPaymentEvent(sendQuote: SparkSendQuote, payment: Payment, eventType: 'paymentSucceeded' | 'paymentFailed'): Promise<void>` (succeeded → complete + `send:completed`; failed → fail + `send:failed`, expiry-aware reason). `reconcile` is added in Task 3.

- [ ] **Step 1: Write the failing test** — `spark-send-orchestrator.test.ts`

```ts
import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import type { Payment } from '@agicash/breez-sdk-spark';
import { DomainError } from '../../errors';
import { SdkEventEmitter } from '../event-emitter';
import type { SdkEventMap } from '../../events';
import type { SparkAccount } from '../../types/account';
import type { SparkSendQuote } from '../../types/spark';
import type { SparkSendQuoteService } from '../../domains/spark/spark-send-quote-service';
import { SparkSendOrchestrator } from './spark-send-orchestrator';

const sats = (n: number) => new Money({ amount: n, currency: 'BTC', unit: 'sat' }) as Money;
const account = { id: 'acc-1', type: 'spark', currency: 'BTC' } as unknown as SparkAccount;

function unpaid(over: Partial<SparkSendQuote> = {}): SparkSendQuote {
  return {
    id: 'sq-1', state: 'UNPAID', amount: sats(100), transactionId: 'tx-1',
    accountId: 'acc-1', expiresAt: null, paymentHash: 'ph-1', paymentRequest: 'lnbc1',
    ...over,
  } as unknown as SparkSendQuote;
}
function pending(over: Partial<SparkSendQuote> = {}): SparkSendQuote {
  return { ...unpaid(), state: 'PENDING', sparkTransferId: 'pay-1', ...over } as unknown as SparkSendQuote;
}
function lightningPayment(over: { id?: string; status?: Payment['status']; preimage?: string } = {}): Payment {
  return {
    id: over.id ?? 'pay-1', status: over.status ?? 'completed', amount: 100n, fees: 0n,
    details: { type: 'lightning', htlcDetails: { paymentHash: 'ph-1', preimage: over.preimage, status: 'preimageShared' } },
  } as unknown as Payment;
}

function makeDeps(serviceOver: Partial<Record<keyof SparkSendQuoteService, unknown>> = {}) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const sendQuoteService = {
    initiateSend: mock(async ({ sendQuote }: { sendQuote: SparkSendQuote }) => ({ ...sendQuote, state: 'PENDING', sparkTransferId: 'pay-1' })),
    complete: mock(async (q: SparkSendQuote) => ({ ...q, state: 'COMPLETED' })),
    fail: mock(async (q: SparkSendQuote) => ({ ...q, state: 'FAILED' })),
    ...serviceOver,
  } as unknown as SparkSendQuoteService;
  const orchestrator = new SparkSendOrchestrator({
    sendQuoteService,
    getAccount: mock(async () => account),
    emitter,
  });
  return { orchestrator, sendQuoteService, emitter };
}

describe('SparkSendOrchestrator transitions', () => {
  it('initiateSend: UNPAID → PENDING emits send:pending', async () => {
    const { orchestrator, sendQuoteService, emitter } = makeDeps();
    const events: { quoteId: string }[] = [];
    emitter.on('send:pending', (e) => events.push(e));
    await orchestrator.initiateSend(account, unpaid());
    expect(sendQuoteService.initiateSend).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ quoteId: 'sq-1', transactionId: 'tx-1', protocol: 'spark' }] as never);
  });

  it('initiateSend: no-op when quote is not UNPAID', async () => {
    const { orchestrator, sendQuoteService } = makeDeps();
    await orchestrator.initiateSend(account, pending());
    expect(sendQuoteService.initiateSend).not.toHaveBeenCalled();
  });

  it('initiateSend: DomainError → fail + send:failed', async () => {
    const { orchestrator, sendQuoteService, emitter } = makeDeps({
      initiateSend: mock(async () => { throw new DomainError('Lightning network fee has changed', 'fee_changed'); }),
    });
    const failed: { quoteId: string; error: { code: string } }[] = [];
    emitter.on('send:failed', (e) => failed.push(e as never));
    await orchestrator.initiateSend(account, unpaid());
    expect(sendQuoteService.fail).toHaveBeenCalledTimes(1);
    expect(failed[0]?.error.code).toBe('spark_send_failed');
  });

  it('initiateSend: rethrows non-DomainError', async () => {
    const { orchestrator } = makeDeps({
      initiateSend: mock(async () => { throw new Error('network blip'); }),
    });
    await expect(orchestrator.initiateSend(account, unpaid())).rejects.toThrow('network blip');
  });

  it('applyPaymentEvent paymentSucceeded: completes + emits send:completed (preimage extracted)', async () => {
    const { orchestrator, sendQuoteService, emitter } = makeDeps();
    const done: { quoteId: string }[] = [];
    emitter.on('send:completed', (e) => done.push(e as never));
    await orchestrator.applyPaymentEvent(pending(), lightningPayment({ preimage: 'pre-1' }), 'paymentSucceeded');
    expect(sendQuoteService.complete).toHaveBeenCalledWith(expect.objectContaining({ id: 'sq-1' }), 'pre-1');
    expect(done).toHaveLength(1);
  });

  it('applyPaymentEvent paymentSucceeded with NO preimage: does not complete', async () => {
    const { orchestrator, sendQuoteService } = makeDeps();
    await orchestrator.applyPaymentEvent(pending(), lightningPayment({ preimage: undefined }), 'paymentSucceeded');
    expect(sendQuoteService.complete).not.toHaveBeenCalled();
  });

  it('applyPaymentEvent paymentFailed: fails with expiry-aware reason + emits send:failed', async () => {
    const { orchestrator, sendQuoteService, emitter } = makeDeps();
    const failed: { error: { message: string } }[] = [];
    emitter.on('send:failed', (e) => failed.push(e as never));
    const expired = pending({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    await orchestrator.applyPaymentEvent(expired, lightningPayment({ status: 'failed' }), 'paymentFailed');
    expect(sendQuoteService.fail).toHaveBeenCalledWith(expect.objectContaining({ id: 'sq-1' }), 'Lightning invoice expired.');
    expect(failed[0]?.error.message).toBe('Lightning invoice expired.');
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/orchestrator/spark-send-orchestrator.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `spark-send-orchestrator.ts`

```ts
import type { Payment } from '@agicash/breez-sdk-spark';
import type { SparkSendQuoteService } from '../../domains/spark/spark-send-quote-service';
import { DomainError, SdkError } from '../../errors';
import type { SdkEventMap } from '../../events';
import type { SparkAccount } from '../../types/account';
import type { SparkSendQuote } from '../../types/spark';
import type { SdkEventEmitter } from '../event-emitter';

type SparkPaymentEventType = 'paymentSucceeded' | 'paymentFailed';

export type SparkSendOrchestratorDeps = {
  sendQuoteService: SparkSendQuoteService;
  getAccount: (accountId: string) => Promise<SparkAccount | null>;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/**
 * Drives spark lightning sends. `initiateSend` is the UNPAID→PENDING kick (Breez
 * `sendPayment`); the terminal state arrives asynchronously via the Breez payment
 * event listener (`reconcile`), surfaced as `send:completed`/`send:failed`.
 * `executeQuote` wiring + the poll cadence are S9's job.
 */
export class SparkSendOrchestrator {
  constructor(private readonly deps: SparkSendOrchestratorDeps) {}

  async initiateSend(account: SparkAccount, sendQuote: SparkSendQuote): Promise<void> {
    if (sendQuote.state !== 'UNPAID') return;
    const { sendQuoteService, emitter } = this.deps;
    try {
      const updated = await sendQuoteService.initiateSend({ account, sendQuote });
      if (updated.state === 'PENDING') {
        emitter.emit('send:pending', {
          quoteId: updated.id,
          transactionId: updated.transactionId,
          protocol: 'spark',
        });
      }
    } catch (error) {
      if (error instanceof DomainError) {
        const failed = await sendQuoteService.fail(sendQuote, error.message);
        if (failed.state === 'FAILED') {
          emitter.emit('send:failed', {
            quoteId: failed.id,
            error: new SdkError(error.message, 'spark_send_failed'),
            protocol: 'spark',
          });
        }
        return;
      }
      throw error;
    }
  }

  async applyPaymentEvent(
    sendQuote: SparkSendQuote,
    payment: Payment,
    eventType: SparkPaymentEventType,
  ): Promise<void> {
    const { sendQuoteService, emitter } = this.deps;

    if (eventType === 'paymentSucceeded') {
      const preimage =
        payment.details?.type === 'lightning'
          ? payment.details.htlcDetails.preimage
          : undefined;
      if (!preimage) {
        console.error('spark send payment succeeded but no preimage', {
          paymentId: payment.id,
          quoteId: sendQuote.id,
        });
        return;
      }
      const completed = await sendQuoteService.complete(sendQuote, preimage);
      if (completed.state === 'COMPLETED') {
        emitter.emit('send:completed', {
          quoteId: completed.id,
          transactionId: completed.transactionId,
          amount: completed.amount,
          protocol: 'spark',
        });
      }
      return;
    }

    const message =
      sendQuote.expiresAt && new Date(sendQuote.expiresAt) < new Date()
        ? 'Lightning invoice expired.'
        : 'Lightning payment failed.';
    const failed = await sendQuoteService.fail(sendQuote, message);
    if (failed.state === 'FAILED') {
      emitter.emit('send:failed', {
        quoteId: failed.id,
        error: new SdkError(message, 'spark_send_failed'),
        protocol: 'spark',
      });
    }
  }
}
```

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/orchestrator/spark-send-orchestrator.test.ts`. Expected: 7 pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/orchestrator/spark-send-orchestrator.ts src/internal/orchestrator/spark-send-orchestrator.test.ts
git commit -m "feat(wallet-sdk): spark send orchestrator transitions (initiateSend kick + payment-event complete/fail)"
```

---

## Task 3: `SparkSendOrchestrator.reconcile` (Breez listener + initial getPayment recovery)

**Files:**
- Modify: `packages/wallet-sdk/src/internal/orchestrator/spark-send-orchestrator.ts` (add `reconcile`)
- Modify: `packages/wallet-sdk/src/internal/orchestrator/spark-send-orchestrator.test.ts` (add a `describe('reconcile')` block)

**Interfaces:**
- Produces: `SparkSendOrchestrator.reconcile(sendQuotes: SparkSendQuote[]): Promise<() => void>` — kicks UNPAID quotes via `initiateSend`; for PENDING quotes attaches one Breez listener per account (routing `paymentSucceeded`/`paymentFailed` by `payment.id → quote.sparkTransferId` through `applyPaymentEvent`); runs the initial `getPayment({paymentId: quote.sparkTransferId})` recovery for events missed before registration; dedupes duplicate deliveries per `${quoteId}:${eventType}`; returns a cleanup thunk detaching all listeners.

- [ ] **Step 1: Write the failing test** — append to `spark-send-orchestrator.test.ts`

```ts
import type { SdkEvent } from '@agicash/breez-sdk-spark';

function makeFakeWallet(opts: { payment?: Payment } = {}) {
  let onEvent: ((e: SdkEvent) => void) | undefined;
  const removeEventListener = mock(async () => true);
  const getPayment = mock(async () => ({ payment: opts.payment }));
  const wallet = {
    addEventListener: mock(async (l: { onEvent: (e: SdkEvent) => void }) => {
      onEvent = l.onEvent;
      return 'listener-1';
    }),
    removeEventListener,
    getPayment,
  } as unknown as SparkAccount['wallet'];
  return { wallet, removeEventListener, getPayment, fire: (e: SdkEvent) => onEvent?.(e) };
}

describe('SparkSendOrchestrator.reconcile', () => {
  it('kicks UNPAID quotes via initiateSend', async () => {
    const { orchestrator, sendQuoteService } = makeDeps();
    await orchestrator.reconcile([unpaid()]);
    await flush();
    expect(sendQuoteService.initiateSend).toHaveBeenCalledTimes(1);
  });

  it('routes a Breez paymentSucceeded for a PENDING quote into send:completed', async () => {
    const fake = makeFakeWallet();
    const acc = { ...account, wallet: fake.wallet } as unknown as SparkAccount;
    const { orchestrator, emitter } = makeDeps();
    (orchestrator as unknown as { deps: SparkSendOrchestratorDepsLike }).deps.getAccount = mock(async () => acc);
    const done: unknown[] = [];
    emitter.on('send:completed', (e) => done.push(e));
    await orchestrator.reconcile([pending()]);
    fake.fire({ type: 'paymentSucceeded', payment: lightningPayment({ id: 'pay-1', preimage: 'pre-1' }) });
    await flush();
    expect(done).toHaveLength(1);
  });

  it('initial getPayment recovery completes a quote whose success fired before registration; duplicate listener delivery is deduped', async () => {
    const fake = makeFakeWallet({ payment: lightningPayment({ id: 'pay-1', preimage: 'pre-1', status: 'completed' }) });
    const acc = { ...account, wallet: fake.wallet } as unknown as SparkAccount;
    const { orchestrator, sendQuoteService, emitter } = makeDeps();
    (orchestrator as unknown as { deps: SparkSendOrchestratorDepsLike }).deps.getAccount = mock(async () => acc);
    const done: unknown[] = [];
    emitter.on('send:completed', (e) => done.push(e));
    await orchestrator.reconcile([pending()]);
    fake.fire({ type: 'paymentSucceeded', payment: lightningPayment({ id: 'pay-1', preimage: 'pre-1' }) }); // also delivered live
    await flush();
    expect(sendQuoteService.complete).toHaveBeenCalledTimes(1); // deduped
    expect(done).toHaveLength(1);
  });

  it('cleanup detaches listeners', async () => {
    const fake = makeFakeWallet();
    const acc = { ...account, wallet: fake.wallet } as unknown as SparkAccount;
    const { orchestrator } = makeDeps();
    (orchestrator as unknown as { deps: SparkSendOrchestratorDepsLike }).deps.getAccount = mock(async () => acc);
    const cleanup = await orchestrator.reconcile([pending()]);
    cleanup();
    await flush();
    expect(fake.removeEventListener).toHaveBeenCalledWith('listener-1');
  });
});

type SparkSendOrchestratorDepsLike = { getAccount: (id: string) => Promise<SparkAccount | null> };
```

> Note: the `(orchestrator as … ).deps.getAccount = …` reassignment swaps in a per-test wallet without exposing internals on the public surface; alternatively, construct a fresh orchestrator with a `getAccount` returning the fake-wallet account. Pick one consistently. (`flush` is the same helper defined in Task 1's test — define it once at the top of this file if not already present.)

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/orchestrator/spark-send-orchestrator.test.ts -t reconcile`. Expected: FAIL (`reconcile is not a function`).

- [ ] **Step 3: Implement** — add `reconcile` to `SparkSendOrchestrator`

```ts
  async reconcile(sendQuotes: SparkSendQuote[]): Promise<() => void> {
    if (sendQuotes.length === 0) return () => {};
    const triggered = new Set<string>();
    const cleanups: Array<() => void> = [];

    const pendingByAccount = new Map<string, Extract<SparkSendQuote, { state: 'PENDING' }>[]>();
    for (const quote of sendQuotes) {
      if (quote.state === 'UNPAID') {
        const account = await this.deps.getAccount(quote.accountId);
        if (!account) continue;
        void this.initiateSend(account, quote).catch((error) =>
          console.error('spark send initiate failed', { quoteId: quote.id, cause: error }),
        );
      } else if (quote.state === 'PENDING') {
        const list = pendingByAccount.get(quote.accountId) ?? [];
        list.push(quote);
        pendingByAccount.set(quote.accountId, list);
      }
    }

    for (const [accountId, quotes] of pendingByAccount) {
      const account = await this.deps.getAccount(accountId);
      if (!account) continue;
      const quoteByTransferId = new Map(quotes.map((q) => [q.sparkTransferId, q]));

      const handle = (payment: Payment, eventType: SparkPaymentEventType) => {
        const quote = quoteByTransferId.get(payment.id);
        if (!quote) return;
        const key = `${quote.id}:${eventType}`;
        if (triggered.has(key)) return;
        triggered.add(key);
        void this.applyPaymentEvent(quote, payment, eventType).catch((error) =>
          console.error('spark send payment event failed', { quoteId: quote.id, cause: error }),
        );
      };

      const listenerPromise = account.wallet.addEventListener({
        onEvent: (event) => {
          if (event.type === 'paymentSucceeded' || event.type === 'paymentFailed') {
            handle(event.payment, event.type);
          }
        },
      });
      cleanups.push(() => {
        void listenerPromise
          .then((id) => account.wallet.removeEventListener(id))
          .catch(() => console.warn('Failed to remove Spark send listener', { accountId }));
      });

      for (const quote of quotes) {
        void account.wallet
          .getPayment({ paymentId: quote.sparkTransferId })
          .then(({ payment }) => {
            if (payment.status === 'completed') handle(payment, 'paymentSucceeded');
            else if (payment.status === 'failed') handle(payment, 'paymentFailed');
          })
          .catch((error) =>
            console.error('spark send initial status check failed', {
              sparkTransferId: quote.sparkTransferId,
              cause: error,
            }),
          );
      }
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }
```

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/orchestrator/spark-send-orchestrator.test.ts`. Expected: 11 pass (7 from Task 2 + 4 new).

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/orchestrator/spark-send-orchestrator.ts src/internal/orchestrator/spark-send-orchestrator.test.ts
git commit -m "feat(wallet-sdk): spark send orchestrator reconcile (per-account Breez listener + getPayment recovery)"
```

---

## Task 4: `SparkReceiveOrchestrator` — `applyPaymentSucceeded` + `applyExpiry`

**Files:**
- Create: `packages/wallet-sdk/src/internal/orchestrator/spark-receive-orchestrator.ts`
- Test: `packages/wallet-sdk/src/internal/orchestrator/spark-receive-orchestrator.test.ts`

**Interfaces:**
- Consumes: `SparkReceiveQuoteService.complete(quote, preimage, sparkTransferId)` / `.expire(quote)` (void) / `.fail(quote, reason)` (void) / `.markMeltInitiated(quote)`; `MeltQuoteSubscriptionManager` (Task 6).
- Produces:
  - `type SparkReceiveOrchestratorDeps = { receiveQuoteService: SparkReceiveQuoteService; getAccount: (accountId: string) => Promise<SparkAccount | null>; meltSubscriptionManager: MeltQuoteSubscriptionManager; emitter: SdkEventEmitter<SdkEventMap> }`
  - `class SparkReceiveOrchestrator` with `applyPaymentSucceeded(quote: SparkReceiveQuote, payment: Payment): Promise<void>` (lightning details → complete(quote, preimage, payment.id) + `receive:completed`) and `applyExpiry(quote: SparkReceiveQuote): Promise<void>` (UNPAID & past-expiry → expire + `receive:expired`). `reconcile` (T5) and cross-mint methods (T6) added later.

- [ ] **Step 1: Write the failing test** — `spark-receive-orchestrator.test.ts`

```ts
import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import type { Payment } from '@agicash/breez-sdk-spark';
import { SdkEventEmitter } from '../event-emitter';
import type { SdkEventMap } from '../../events';
import type { SparkAccount } from '../../types/account';
import type { SparkReceiveQuote } from '../../types/spark';
import type { SparkReceiveQuoteService } from '../../domains/spark/spark-receive-quote-service';
import { SparkReceiveOrchestrator } from './spark-receive-orchestrator';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sats = (n: number) => new Money({ amount: n, currency: 'BTC', unit: 'sat' }) as Money;
const account = { id: 'acc-1', type: 'spark', currency: 'BTC' } as unknown as SparkAccount;

function unpaidLightning(over: Partial<SparkReceiveQuote> = {}): SparkReceiveQuote {
  return {
    id: 'rq-1', type: 'LIGHTNING', state: 'UNPAID', amount: sats(100), transactionId: 'tx-1',
    accountId: 'acc-1', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    paymentHash: 'ph-1', paymentRequest: 'lnbc1',
    ...over,
  } as unknown as SparkReceiveQuote;
}
function lightningPayment(over: { id?: string; status?: Payment['status']; paymentHash?: string; preimage?: string } = {}): Payment {
  return {
    id: over.id ?? 'pay-1', status: over.status ?? 'completed', amount: 100n, fees: 0n,
    details: { type: 'lightning', htlcDetails: { paymentHash: over.paymentHash ?? 'ph-1', preimage: over.preimage, status: 'preimageShared' } },
  } as unknown as Payment;
}

function makeDeps(serviceOver: Partial<Record<keyof SparkReceiveQuoteService, unknown>> = {}) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const receiveQuoteService = {
    complete: mock(async (q: SparkReceiveQuote) => ({ ...q, state: 'PAID' })),
    expire: mock(async () => {}),
    fail: mock(async () => {}),
    markMeltInitiated: mock(async (q: SparkReceiveQuote) => q),
    ...serviceOver,
  } as unknown as SparkReceiveQuoteService;
  const orchestrator = new SparkReceiveOrchestrator({
    receiveQuoteService,
    getAccount: mock(async () => account),
    meltSubscriptionManager: {} as never,
    emitter,
  });
  return { orchestrator, receiveQuoteService, emitter };
}

describe('SparkReceiveOrchestrator transitions', () => {
  it('applyPaymentSucceeded: completes with sparkTransferId=payment.id + emits receive:completed', async () => {
    const { orchestrator, receiveQuoteService, emitter } = makeDeps();
    const done: unknown[] = [];
    emitter.on('receive:completed', (e) => done.push(e));
    await orchestrator.applyPaymentSucceeded(unpaidLightning(), lightningPayment({ id: 'pay-9', preimage: 'pre-1' }));
    expect(receiveQuoteService.complete).toHaveBeenCalledWith(expect.objectContaining({ id: 'rq-1' }), 'pre-1', 'pay-9');
    expect(done).toHaveLength(1);
  });

  it('applyPaymentSucceeded: no preimage → does not complete', async () => {
    const { orchestrator, receiveQuoteService } = makeDeps();
    await orchestrator.applyPaymentSucceeded(unpaidLightning(), lightningPayment({ preimage: undefined }));
    expect(receiveQuoteService.complete).not.toHaveBeenCalled();
  });

  it('applyPaymentSucceeded: non-lightning details → ignored', async () => {
    const { orchestrator, receiveQuoteService } = makeDeps();
    const spark = { id: 'pay-1', status: 'completed', amount: 1n, fees: 0n, details: { type: 'spark' } } as unknown as Payment;
    await orchestrator.applyPaymentSucceeded(unpaidLightning(), spark);
    expect(receiveQuoteService.complete).not.toHaveBeenCalled();
  });

  it('applyExpiry: UNPAID & past expiry → expire + emit receive:expired', async () => {
    const { orchestrator, receiveQuoteService, emitter } = makeDeps();
    const expired: unknown[] = [];
    emitter.on('receive:expired', (e) => expired.push(e));
    await orchestrator.applyExpiry(unpaidLightning({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(receiveQuoteService.expire).toHaveBeenCalledTimes(1);
    expect(expired).toEqual([{ quoteId: 'rq-1', protocol: 'spark' }] as never);
  });

  it('applyExpiry: not yet expired → no-op', async () => {
    const { orchestrator, receiveQuoteService } = makeDeps();
    await orchestrator.applyExpiry(unpaidLightning());
    expect(receiveQuoteService.expire).not.toHaveBeenCalled();
  });

  it('applyExpiry: non-UNPAID → no-op', async () => {
    const { orchestrator, receiveQuoteService } = makeDeps();
    await orchestrator.applyExpiry(unpaidLightning({ state: 'PAID' } as never));
    expect(receiveQuoteService.expire).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/orchestrator/spark-receive-orchestrator.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `spark-receive-orchestrator.ts` (only the parts needed for Task 4; `reconcile` + cross-mint added in T5/T6)

```ts
import { type MeltQuoteBolt11Response, MeltQuoteState } from '@cashu/cashu-ts';
import type { Payment } from '@agicash/breez-sdk-spark';
import type { SparkReceiveQuoteService } from '../../domains/spark/spark-receive-quote-service';
import { SdkError } from '../../errors';
import type { SdkEventMap } from '../../events';
import type { SparkAccount } from '../../types/account';
import type { SparkReceiveQuote } from '../../types/spark';
import type { SdkEventEmitter } from '../event-emitter';
import type { MeltQuoteSubscriptionManager } from '../lib/cashu/melt-quote-subscription-manager';

type CashuTokenSparkReceiveQuote = SparkReceiveQuote & { type: 'CASHU_TOKEN' };

export type SparkReceiveOrchestratorDeps = {
  receiveQuoteService: SparkReceiveQuoteService;
  getAccount: (accountId: string) => Promise<SparkAccount | null>;
  meltSubscriptionManager: MeltQuoteSubscriptionManager;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/**
 * Drives spark receives. Lightning receives complete on Breez `paymentSucceeded`
 * (matched by HTLC `paymentHash`); expiry is detected via the `synced` event sweep.
 * The CASHU_TOKEN cross-mint sub-flow melts the source-mint proofs (cashu melt-quote
 * WS via the reused MeltQuoteSubscriptionManager) and marks/fails the spark quote.
 * Subscription lifecycle + poll cadence are S9's job.
 */
export class SparkReceiveOrchestrator {
  constructor(private readonly deps: SparkReceiveOrchestratorDeps) {}

  async applyPaymentSucceeded(quote: SparkReceiveQuote, payment: Payment): Promise<void> {
    const details = payment.details;
    if (details?.type !== 'lightning') return;
    const preimage = details.htlcDetails.preimage;
    if (!preimage) {
      console.error('spark receive payment succeeded but no preimage', {
        paymentId: payment.id,
        quoteId: quote.id,
      });
      return;
    }
    const completed = await this.deps.receiveQuoteService.complete(quote, preimage, payment.id);
    if (completed.state === 'PAID') {
      this.deps.emitter.emit('receive:completed', {
        quoteId: completed.id,
        transactionId: completed.transactionId,
        amount: completed.amount,
        protocol: 'spark',
      });
    }
  }

  async applyExpiry(quote: SparkReceiveQuote): Promise<void> {
    if (quote.state !== 'UNPAID') return;
    if (new Date(quote.expiresAt) >= new Date()) return;
    await this.deps.receiveQuoteService.expire(quote);
    this.deps.emitter.emit('receive:expired', { quoteId: quote.id, protocol: 'spark' });
  }
}
```

> The `MeltQuoteBolt11Response`/`MeltQuoteState`/`SdkError`/`CashuTokenSparkReceiveQuote` imports are unused until Task 6. If `bun run typecheck`'s no-unused rule complains at this task, add the cross-mint methods (Task 6) in the same task or temporarily omit those imports and reintroduce them in Task 6. Prefer to keep them only if the project's lint allows unused imports under `typecheck` (it runs `tsc --noEmit`, which does **not** error on unused imports — verify on first run; if it does, drop the four cross-mint-only imports here and add them in Task 6).

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/orchestrator/spark-receive-orchestrator.test.ts`. Expected: 6 pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/orchestrator/spark-receive-orchestrator.ts src/internal/orchestrator/spark-receive-orchestrator.test.ts
git commit -m "feat(wallet-sdk): spark receive orchestrator transitions (lightning complete + synced expiry)"
```

---

## Task 5: `SparkReceiveOrchestrator.reconcile` (Breez listener + `synced` expiry sweep + getPaymentByInvoice recovery)

**Files:**
- Modify: `packages/wallet-sdk/src/internal/orchestrator/spark-receive-orchestrator.ts` (add `reconcile`)
- Modify: `packages/wallet-sdk/src/internal/orchestrator/spark-receive-orchestrator.test.ts`

**Interfaces:**
- Produces: `SparkReceiveOrchestrator.reconcile(receiveQuotes: SparkReceiveQuote[]): Promise<() => void>` — filters to UNPAID, groups by account, attaches one Breez listener per account (route `paymentSucceeded` by `details.htlcDetails.paymentHash → quote.paymentHash` through `applyPaymentSucceeded`; on `synced` sweep the account's quotes through `applyExpiry`), runs the initial `getPaymentByInvoice({invoice: quote.paymentRequest})` recovery, dedupes per `${quoteId}:completed` / `${quoteId}:expired`, returns a cleanup thunk.

- [ ] **Step 1: Write the failing test** — append to `spark-receive-orchestrator.test.ts`

```ts
import type { SdkEvent } from '@agicash/breez-sdk-spark';

function makeFakeWallet(opts: { paymentByInvoice?: Payment } = {}) {
  let onEvent: ((e: SdkEvent) => void) | undefined;
  const removeEventListener = mock(async () => true);
  const getPaymentByInvoice = mock(async () => ({ payment: opts.paymentByInvoice }));
  const wallet = {
    addEventListener: mock(async (l: { onEvent: (e: SdkEvent) => void }) => {
      onEvent = l.onEvent;
      return 'listener-1';
    }),
    removeEventListener,
    getPaymentByInvoice,
  } as unknown as SparkAccount['wallet'];
  return { wallet, removeEventListener, getPaymentByInvoice, fire: (e: SdkEvent) => onEvent?.(e) };
}

function withWallet(wallet: SparkAccount['wallet'], serviceOver = {}) {
  const acc = { ...account, wallet } as unknown as SparkAccount;
  const deps = makeDeps(serviceOver);
  (deps.orchestrator as unknown as { deps: { getAccount: (id: string) => Promise<SparkAccount> } }).deps.getAccount = mock(async () => acc);
  return deps;
}

describe('SparkReceiveOrchestrator.reconcile', () => {
  it('routes a Breez paymentSucceeded (matched by paymentHash) into receive:completed', async () => {
    const fake = makeFakeWallet();
    const { orchestrator, emitter } = withWallet(fake.wallet);
    const done: unknown[] = [];
    emitter.on('receive:completed', (e) => done.push(e));
    await orchestrator.reconcile([unpaidLightning({ paymentHash: 'ph-7' })]);
    fake.fire({ type: 'paymentSucceeded', payment: lightningPayment({ id: 'pay-9', paymentHash: 'ph-7', preimage: 'pre-1' }) });
    await flush();
    expect(done).toHaveLength(1);
  });

  it('synced fired twice → expires + emits receive:expired exactly once (dedupe)', async () => {
    const fake = makeFakeWallet();
    const { orchestrator, receiveQuoteService, emitter } = withWallet(fake.wallet);
    const expired: unknown[] = [];
    emitter.on('receive:expired', (e) => expired.push(e));
    await orchestrator.reconcile([unpaidLightning({ expiresAt: new Date(Date.now() - 1000).toISOString() })]);
    fake.fire({ type: 'synced' });
    fake.fire({ type: 'synced' });
    await flush();
    expect(receiveQuoteService.expire).toHaveBeenCalledTimes(1);
    expect(expired).toHaveLength(1);
  });

  it('initial getPaymentByInvoice recovery completes a quote whose success fired before registration', async () => {
    const fake = makeFakeWallet({ paymentByInvoice: lightningPayment({ id: 'pay-9', paymentHash: 'ph-1', preimage: 'pre-1', status: 'completed' }) });
    const { orchestrator, receiveQuoteService } = withWallet(fake.wallet);
    await orchestrator.reconcile([unpaidLightning()]);
    await flush();
    expect(receiveQuoteService.complete).toHaveBeenCalledTimes(1);
  });

  it('cleanup detaches listeners', async () => {
    const fake = makeFakeWallet();
    const { orchestrator } = withWallet(fake.wallet);
    const cleanup = await orchestrator.reconcile([unpaidLightning()]);
    cleanup();
    await flush();
    expect(fake.removeEventListener).toHaveBeenCalledWith('listener-1');
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/orchestrator/spark-receive-orchestrator.test.ts -t reconcile`. Expected: FAIL (`reconcile is not a function`).

- [ ] **Step 3: Implement** — add `reconcile` to `SparkReceiveOrchestrator`

```ts
  async reconcile(receiveQuotes: SparkReceiveQuote[]): Promise<() => void> {
    const pending = receiveQuotes.filter((q) => q.state === 'UNPAID');
    if (pending.length === 0) return () => {};
    const triggered = new Set<string>();
    const cleanups: Array<() => void> = [];

    const byAccount = new Map<string, SparkReceiveQuote[]>();
    for (const quote of pending) {
      const list = byAccount.get(quote.accountId) ?? [];
      list.push(quote);
      byAccount.set(quote.accountId, list);
    }

    for (const [accountId, quotes] of byAccount) {
      const account = await this.deps.getAccount(accountId);
      if (!account) continue;
      const quoteByPaymentHash = new Map(quotes.map((q) => [q.paymentHash, q]));

      const handleSucceeded = (payment: Payment) => {
        const details = payment.details;
        if (details?.type !== 'lightning') return;
        const quote = quoteByPaymentHash.get(details.htlcDetails.paymentHash);
        if (!quote) return;
        const key = `${quote.id}:completed`;
        if (triggered.has(key)) return;
        triggered.add(key);
        void this.applyPaymentSucceeded(quote, payment).catch((error) =>
          console.error('spark receive payment event failed', { quoteId: quote.id, cause: error }),
        );
      };

      const listenerPromise = account.wallet.addEventListener({
        onEvent: (event) => {
          if (event.type === 'paymentSucceeded') {
            handleSucceeded(event.payment);
          } else if (event.type === 'synced') {
            for (const quote of quotes) {
              const key = `${quote.id}:expired`;
              if (triggered.has(key)) continue;
              if (new Date(quote.expiresAt) >= new Date()) continue;
              triggered.add(key);
              void this.applyExpiry(quote).catch((error) =>
                console.error('spark receive expiry failed', { quoteId: quote.id, cause: error }),
              );
            }
          }
        },
      });
      cleanups.push(() => {
        void listenerPromise
          .then((id) => account.wallet.removeEventListener(id))
          .catch(() => console.warn('Failed to remove Spark receive listener', { accountId }));
      });

      for (const quote of quotes) {
        void account.wallet
          .getPaymentByInvoice({ invoice: quote.paymentRequest })
          .then((response) => {
            if (response.payment && response.payment.status === 'completed') {
              handleSucceeded(response.payment);
            }
          })
          .catch((error) =>
            console.error('spark receive initial status check failed', {
              quoteId: quote.id,
              cause: error,
            }),
          );
      }
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }
```

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/orchestrator/spark-receive-orchestrator.test.ts`. Expected: 10 pass (6 + 4).

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/orchestrator/spark-receive-orchestrator.ts src/internal/orchestrator/spark-receive-orchestrator.test.ts
git commit -m "feat(wallet-sdk): spark receive orchestrator reconcile (Breez listener + synced expiry sweep + getPaymentByInvoice recovery)"
```

---

## Task 6: `SparkReceiveOrchestrator` — CASHU_TOKEN cross-mint melt (reuse `MeltQuoteSubscriptionManager`)

**Files:**
- Modify: `packages/wallet-sdk/src/internal/orchestrator/spark-receive-orchestrator.ts` (add `applyCrossMintMeltState` + `reconcileCrossMintMelts`)
- Modify: `packages/wallet-sdk/src/internal/orchestrator/spark-receive-orchestrator.test.ts`

**Interfaces:**
- Consumes: `MeltQuoteSubscriptionManager.subscribe({mintUrl, quoteIds, onUpdate})`; `SparkReceiveQuoteService.markMeltInitiated(quote)` / `.fail(quote, reason)`.
- Produces:
  - `SparkReceiveOrchestrator.applyCrossMintMeltState(quote: SparkReceiveQuote & {type:'CASHU_TOKEN'}, meltQuote: MeltQuoteBolt11Response, handlers: { initiateMelt: (quote) => Promise<void> }): Promise<void>` — melt `UNPAID` + `meltInitiated` → fail + `receive:failed`; `UNPAID` + not initiated → `handlers.initiateMelt(quote)`; melt `PENDING` → `markMeltInitiated`.
  - `SparkReceiveOrchestrator.reconcileCrossMintMelts(receiveQuotes: SparkReceiveQuote[], handlers): Promise<void>` — filters CASHU_TOKEN+UNPAID, groups by `tokenReceiveData.sourceMintUrl` with ids `tokenReceiveData.meltQuoteId`, subscribes the melt manager, routes `onUpdate` by `meltQuote.quote → quote`, dedupes per `${quoteId}:${meltQuote.state}`.

> This is a near-verbatim port of 07a's `CashuReceiveQuoteOrchestrator.applyCrossMintMeltState` + `reconcileCrossMintMelts`, swapping `CashuReceiveQuoteService` → `SparkReceiveQuoteService` (drives `markMeltInitiated`/`fail`) and emitting `protocol:'spark'`. `initiateMelt` is an INJECTED `handlers` arg (not a dep): the actual melt runs on the **source cashu wallet**, which S9 resolves. The dedupe set fixes the M1-class double-emit (D4).

- [ ] **Step 1: Write the failing test** — append to `spark-receive-orchestrator.test.ts`

```ts
import { type MeltQuoteBolt11Response, MeltQuoteState } from '@cashu/cashu-ts';

function tokenQuote(over: Partial<{ meltInitiated: boolean }> = {}): SparkReceiveQuote {
  return {
    id: 'rq-2', type: 'CASHU_TOKEN', state: 'UNPAID', amount: sats(100), transactionId: 'tx-2',
    accountId: 'acc-1', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    paymentHash: 'ph-2', paymentRequest: 'lnbc2',
    tokenReceiveData: { sourceMintUrl: 'https://mint.test', meltQuoteId: 'mq-1', meltInitiated: over.meltInitiated ?? false },
  } as unknown as SparkReceiveQuote;
}
const meltResp = (state: MeltQuoteState): MeltQuoteBolt11Response => ({ quote: 'mq-1', state, amount: 100 } as unknown as MeltQuoteBolt11Response);

describe('SparkReceiveOrchestrator cross-mint melt', () => {
  it('melt UNPAID + not initiated → handlers.initiateMelt', async () => {
    const { orchestrator } = makeDeps();
    const initiateMelt = mock(async () => {});
    await orchestrator.applyCrossMintMeltState(tokenQuote() as never, meltResp(MeltQuoteState.UNPAID), { initiateMelt });
    expect(initiateMelt).toHaveBeenCalledTimes(1);
  });

  it('melt UNPAID + already initiated → fail + receive:failed', async () => {
    const { orchestrator, receiveQuoteService, emitter } = makeDeps();
    const failed: { error: { code: string } }[] = [];
    emitter.on('receive:failed', (e) => failed.push(e as never));
    await orchestrator.applyCrossMintMeltState(tokenQuote({ meltInitiated: true }) as never, meltResp(MeltQuoteState.UNPAID), { initiateMelt: mock(async () => {}) });
    expect(receiveQuoteService.fail).toHaveBeenCalledTimes(1);
    expect(failed[0]?.error.code).toBe('spark_token_melt_failed');
  });

  it('melt PENDING → markMeltInitiated', async () => {
    const { orchestrator, receiveQuoteService } = makeDeps();
    await orchestrator.applyCrossMintMeltState(tokenQuote() as never, meltResp(MeltQuoteState.PENDING), { initiateMelt: mock(async () => {}) });
    expect(receiveQuoteService.markMeltInitiated).toHaveBeenCalledTimes(1);
  });

  it('reconcileCrossMintMelts subscribes by sourceMintUrl and routes onUpdate (deduped per state)', async () => {
    let onUpdate: ((q: MeltQuoteBolt11Response) => void) | undefined;
    const subscribe = mock(async (p: { onUpdate: (q: MeltQuoteBolt11Response) => void }) => {
      onUpdate = p.onUpdate;
      return () => {};
    });
    const { orchestrator, receiveQuoteService } = makeDeps();
    (orchestrator as unknown as { deps: { meltSubscriptionManager: unknown } }).deps.meltSubscriptionManager = { subscribe };
    const initiateMelt = mock(async () => {});
    await orchestrator.reconcileCrossMintMelts([tokenQuote({ meltInitiated: true })], { initiateMelt });
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ mintUrl: 'https://mint.test', quoteIds: ['mq-1'] }));
    onUpdate?.(meltResp(MeltQuoteState.UNPAID));
    onUpdate?.(meltResp(MeltQuoteState.UNPAID)); // duplicate delivery
    await flush();
    expect(receiveQuoteService.fail).toHaveBeenCalledTimes(1); // deduped (M1 fix)
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/orchestrator/spark-receive-orchestrator.test.ts -t "cross-mint"`. Expected: FAIL (methods not defined).

- [ ] **Step 3: Implement** — add to `SparkReceiveOrchestrator` (and ensure the `MeltQuoteBolt11Response`/`MeltQuoteState`/`SdkError`/`CashuTokenSparkReceiveQuote` imports from Task 4 are present)

```ts
  async applyCrossMintMeltState(
    quote: CashuTokenSparkReceiveQuote,
    meltQuote: MeltQuoteBolt11Response,
    handlers: { initiateMelt: (quote: CashuTokenSparkReceiveQuote) => Promise<void> },
  ): Promise<void> {
    if (meltQuote.state === MeltQuoteState.UNPAID) {
      if (quote.tokenReceiveData.meltInitiated) {
        await this.deps.receiveQuoteService.fail(quote, 'Cashu token melt failed.');
        this.deps.emitter.emit('receive:failed', {
          quoteId: quote.id,
          error: new SdkError('Cashu token melt failed.', 'spark_token_melt_failed'),
          protocol: 'spark',
        });
      } else {
        await handlers.initiateMelt(quote);
      }
      return;
    }
    if (meltQuote.state === MeltQuoteState.PENDING) {
      await this.deps.receiveQuoteService.markMeltInitiated(quote);
    }
  }

  async reconcileCrossMintMelts(
    receiveQuotes: SparkReceiveQuote[],
    handlers: { initiateMelt: (quote: CashuTokenSparkReceiveQuote) => Promise<void> },
  ): Promise<void> {
    const tokenQuotes = receiveQuotes.filter(
      (q): q is CashuTokenSparkReceiveQuote =>
        q.type === 'CASHU_TOKEN' && q.state === 'UNPAID',
    );
    if (tokenQuotes.length === 0) return;
    const triggered = new Set<string>();
    const byMeltQuoteId = new Map<string, CashuTokenSparkReceiveQuote>();
    const idsByMint = new Map<string, string[]>();
    for (const quote of tokenQuotes) {
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
            console.error('spark receive cross-mint melt update failed', {
              quoteId: quote.id,
              cause: error,
            }),
          );
        },
      });
    }
  }
```

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/orchestrator/spark-receive-orchestrator.test.ts`. Expected: 14 pass (10 + 4).

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/orchestrator/spark-receive-orchestrator.ts src/internal/orchestrator/spark-receive-orchestrator.test.ts
git commit -m "feat(wallet-sdk): spark receive cross-mint CASHU_TOKEN melt completion (reuses MeltQuoteSubscriptionManager)"
```

---

## Task 7: Whole-slice verification gate + dark-build confirmation

**Files:** none changed (verification only).

- [ ] **Step 1: Full SDK gate** — from `packages/wallet-sdk/`:

```bash
bun run typecheck && bun run test
```

Expected: green; SDK test count = the prior 504 + the spark tests added here (≈25; the precise total depends on final test counts — confirm there are **no failures** and the count rose by the new tests only).

- [ ] **Step 2: Confirm the dark build is intact** — none of these should have changed:

```bash
git grep -n "NotImplementedError('spark.send.executeQuote')" src/domains/spark/spark-domain.ts   # still present
git grep -n "createSparkDomain" src/sdk.ts                                                       # still createSparkDomain(ctx) — no accountRepository
git status --short   # clean
```

Expected: `executeQuote` still throws `NotImplementedError`; `sdk.ts` unchanged; tree clean.

- [ ] **Step 3: Confirm the three units are exported and import-reachable** (kept live by their tests; S9 will import by path):

```bash
git grep -n "export class Spark" src/internal/orchestrator/
# → SparkBalanceListener, SparkSendOrchestrator, SparkReceiveOrchestrator
```

- [ ] **Step 4: Commit (if any doc/no-op cleanup)** — usually nothing to commit; if the plan-of-plans index needs the 07b status flipped to "done", do it here:

```bash
git add -A && git commit -m "docs(wallet-sdk): record Plan 07b (spark orchestrator primitives) done + S9 carryover" || echo "nothing to commit"
```

---

## Self-Review

**1. Spec coverage (§9 S7 spark scope + §8 + the prompt's 07b scope):**
- §8 stale-balance `synced` re-read + compare-before-emit → **Task 1** (the mandated §10 regression). ✓
- SparkSendOrchestrator: paymentSucceeded→complete+send:completed, paymentFailed→fail+send:failed, UNPAID kick→PENDING+send:pending, reconcile + initial getPayment recovery → **Tasks 2–3**. ✓
- SparkReceiveOrchestrator: paymentSucceeded (by paymentHash)→complete(quote,preimage,payment.id)+receive:completed, synced→expiry, getPaymentByInvoice recovery → **Tasks 4–5**; CASHU_TOKEN cross-mint melt (reuse MeltQuoteSubscriptionManager + markMeltInitiated/fail) → **Task 6**. ✓
- "2 spark task processors" = `SparkSendOrchestrator.reconcile` + `SparkReceiveOrchestrator.reconcile`/`reconcileCrossMintMelts` (the per-tick entry points S9 calls). ✓
- `spark.send.executeQuote` stays `NotImplementedError`; `createSparkDomain`/`sdk.ts` untouched → **Tasks 4–7 dark-build notes + Task 7 confirmation**. ✓

**2. Placeholder scan:** every code step contains full code; commands have expected output. The one conditional is Task 4's note about unused cross-mint imports under `typecheck` — resolved deterministically (tsc --noEmit does not flag unused imports; if the project enables `noUnusedLocals`, drop those four imports until Task 6). No TBD/TODO.

**3. Type consistency:** `initiateSend({account, sendQuote})` object-param vs positional `complete(quote, preimage)`/`fail(quote, reason)` — matched verbatim to S6. Send completion keys `payment.id ↔ quote.sparkTransferId`; receive completion keys `details.htlcDetails.paymentHash ↔ quote.paymentHash` and passes `sparkTransferId = payment.id`. send:completed uses `completed.amount` (not `amountRequested`). Receive `expire`/`fail` return `void` → emit gated by the `triggered` set; send `complete`/`fail` + receive `complete` return the quote → emit gated on `.state`. `account:updated` payload `{account, op:'updated'}`. Error arities `(message, code)` / `(method)`. All import paths verified.

**Risks / carryover to S9:**
- 07b returns a `() => void` cleanup from each `reconcile` (spark has no self-cleaning subscription manager for the Breez listener). S9 must call the prior cleanup before re-reconciling each tick and on stop, or listeners leak. The `SparkBalanceListener` is long-lived per online account (register on online, cleanup on offline) — not re-attached per tick.
- `executeQuote` (S9): resolve `account` from `quote.accountId` (needs the `accountRepository` param added to `createSparkDomain`), then call `SparkSendOrchestrator.initiateSend(account, quote)` (background-style: DomainError → fail+emit) **or** `sendQuoteService.initiateSend` directly if the foreground flow must surface `fee_changed`/`insufficient_balance` to the UI. Decide at wiring time.
- The CASHU_TOKEN `handlers.initiateMelt` is injected by S9 (the melt runs on the source cashu wallet, resolved by account lookup), exactly as 07a injects it for the cashu cross-mint path.
- The offline Spark stub (`getInitialized` returns a Proxy that throws on every method when offline): S9 must only `register`/`reconcile` for `isOnline` accounts, or `addEventListener` itself will throw.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-07b-spark-orchestrator.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. (REQUIRED SUB-SKILL: superpowers:subagent-driven-development.)
2. **Inline Execution** — execute tasks in this session via superpowers:executing-plans, batch execution with checkpoints.
