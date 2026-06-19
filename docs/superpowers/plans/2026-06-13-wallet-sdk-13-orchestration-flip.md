# Wallet SDK — S13: Reactivity + Orchestration Flip (atomic) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web app fully SDK-driven on the client: replace the web's task-processor + leader election + realtime change-handlers + `{Entity}Cache` machinery with ONE `useSdkEventBridge(queryClient)` (sdk.events → TanStack cache), flip every write mutation to `sdk.*`, start/stop `sdk.background` on the auth lifecycle, and delete the now-dead web orchestration/reactivity/wallet-class/connection code.

**Architecture:** Slice S13 of the no-cache full migration (spec §5 reactive bridge, §8 dual-leader guardrail, §9 atomic cut-over). The SDK is the sole owner of orchestration; TanStack Query stays the web's read cache, now fed by SDK events instead of Supabase realtime. The flip is sequenced as behavior-neutral **PREP commits** (small additive SDK changes + the wallet-class unification + accounts read-flip + the unmounted bridge file) followed by **ONE ATOMIC commit** that mounts the bridge, flips writes, starts background, and deletes the web stack — because the web task-processor and `sdk.background` both poll the same `take_lead` RPC and running both = double melt/mint (real money).

**Tech Stack:** React Router v7, TanStack Query v5, `@agicash/wallet-sdk`, Bun workspaces, `bun:test` (web suite has **no jsdom**), biome.

---

## Global Constraints

- **The dual-leader guardrail is absolute (spec §8).** The web `useTakeTaskProcessingLead` and the SDK `BackgroundRunner` both poll the SAME `take_lead` RPC every 5s with DIFFERENT clientIds. Running both → split-brain leadership → double melt/mint. So **delete the web processor/leader ⇄ start `sdk.background` ⇄ mount the bridge ⇄ flip the money writes** all land in ONE commit (Task 8). Never commit or run an intermediate state with both leaders.
- **Prep is behavior-neutral.** Tasks 1–7 keep the web fully working on its existing realtime/change-handlers/processor. They add SDK surface, re-point types, flip the accounts READ (key preserved → change-handlers keep writing it), and create the bridge file UNMOUNTED. No write mutation flips, no `background.start()`, no deletions in prep.
- **Errors:** `SdkError`/`DomainError`/`NotFoundError` take `(message, code)`; `NotImplementedError(method)`.
- **`fix:all` ≠ typecheck.** `bun run fix:all` = `biome check --write` (lint+format only). Every task gate ALSO runs `bun run typecheck`. S13 touches the SDK → the gate ALSO runs the SDK suite.
- **Per-task gate:** `bun run fix:all` (biome, exit 0) + `bun run typecheck` + `bun --filter=web-wallet run test` + (SDK tasks) `bun --filter=@agicash/wallet-sdk run test`.
- **S13 verification is e2e + manual, not units** (spec §10): the web suite has no jsdom and S13 changes the money paths. `bun run test:e2e` + manual money-path (Chrome DevTools MCP) is the real gate — **ASK the user before running** (needs `VITE_BREEZ_API_KEY` + a live stack/mint).
- **One commit per task. DO NOT push** (the whole migration merges as ONE PR at the very end, spec §9). The worktree is harness-owned (`.claude/worktrees/…`) — do NOT `git worktree remove`. Ignore/`rm` the untracked `sdd/` dir. bun/bunx only; `master` is the default branch. Branch: `sdk-nocache/full-migration` (tip `af0eff89`).

---

## Decisions (locked — resolved with the user 2026-06-19; do NOT re-litigate)

- **D13-1 — Auth stays on OpenSecret through S13; the auth-read flip is its OWN later slice.** `useUser` already self-resolves via `sdk.user.getCurrentUser()` (S12) and is merely GATED by `authQueryOptions` (the deliberate canary). Nothing in the orchestration/background flip reads `authQueryOptions`/`useAuthActions`. Two SDK blockers (auth:session-expired never emitted + no expiry scheduler; `login_method`/cheap-isLoggedIn not on the SDK) make folding-in unsafe. So S13 KEEPS `authQueryOptions`/`useAuthState`/`useAuthActions`/`useHandleSessionExpiry`/the `Sentry.setUser` + session-hint side-effects. The bridge wires `auth:signed-in/out/session-expired` as forward-compatible STUBS only (auth:session-expired has no producer yet).
- **D13-2 — Packaging: behavior-neutral PREP commits, then ONE atomic flip.** PREP = Tasks 1–7. ATOMIC = Task 8 (single commit). The cashu send-swap READ flip is COUPLED to its bridge op → it lives INSIDE Task 8, not prep.
- **D13-3 — Leader-election clientId: OMIT (SDK auto-gen).** Pass NO `SdkConfig.clientId`; the SDK uses `crypto.randomUUID()` per instance — behavior-preserving vs today's per-mount random; the 6s server TTL handles handoff. (The per-tab-stable-id optimization is deferred.)
- **D13-4 — `AddAccountConfig`: extend the SDK additively.** Add `purpose?`+`expiresAt?` (offer keyset-expiry derivation) to `AddAccountConfig.cashu` + `accounts-domain.add` so the web gift-card/offer account creation flips uniformly (Task 2). The `AccountRepository.create` already supports arbitrary purpose/expiry.
- **D13-5 — Fee preview: add an SDK preview op.** Add `sdk.{cashu,spark}.send.previewLightningQuote(params)` returning the ephemeral `CashuLightningQuote`/`SparkLightningQuote` WITHOUT persisting; create+persist+execute only on confirm (Task 3). Avoids cashu proof-reservation orphans on back-out.
- **D13-6 — Reconnect resync: port it, add an SDK reconnect signal.** Add a `realtime:connected` SDK event emitted from the forwarder's `subscribe(..., onConnected)` (the manager already supports it). The bridge re-invalidates the recovered key set on it. Keep a thin web activity-tracking hook that drives the SDK realtime manager's `setOnlineStatus`/`setActiveStatus` (Task 5 exposes a connectivity method; Task 8 wires the thin hook). (See §"Reconnect & activity-tracking".)
- **D13-7 — `account:updated` balance discriminator: add an SDK-side flag.** Extend the `op` union to `'created' | 'updated' | 'balance'`; `SparkBalanceListener` emits `op:'balance'`; the forwarder keeps `'created'/'updated'` (Task 4). The bridge routes `op:'balance'` → `updateSparkAccountBalance` (version-ignoring), else version-aware `upsert`.
- **D13-8 — Bridge runs on ALL tabs, not leader-gated.** It mounts where `useTrackWalletChanges` lived (every protected tab). Only `sdk.background`'s internal TaskLoop is leader-gated; `start()` is called on every tab (it self-elects). The forwarder + balance listeners are always-on inside `background.start()`.
- **D13-9 — `background.start()/stop()` tie to the authed-user lifecycle in `Wallet`.** `start()` parks in `'starting'` if `getUserId()` is null and does NOT auto-recover, so call `stop()` then `start()` keyed on `user.id` (the `Wallet` component already gates on `useUser()`). Mount/unmount `stop()` cleanup.
- **D13-10 — Double-tap guard stays web-side.** The SDK dedupes a repeated `executeQuote` of one quote but does NOT dedupe two `createLightningQuote`/preview→create calls for the same invoice. Keep the existing per-quote mutation in-flight/disabled guard on the confirm action.

---

## The §5 reactivity bridge — event → cache-op table (authoritative; verified 2026-06-19)

The bridge subscribes via `sdk.events.on(event, handler)` (returns a teardown fn; `EventEmitter` exposes ONLY `on`/`once`). SDK event payloads carry **already-converted domain entities** (the forwarder calls `repo.toX` / the domain converts before emit) → the bridge calls NO `repo.toX`. `Transaction`/`Account`/`User` carry `version` INSIDE the entity (no payload-level version); `Contact`/`User` cache are version-less.

| SDK event | cache key | action | version-aware? |
|---|---|---|---|
| `transaction:created {transaction}` | `[TransactionsCache.Key, tx.id]` | `transactionsCache.upsert(tx)`; invalidate `['unacknowledged-transactions-count']` IFF `tx.acknowledgmentStatus==='pending'` | yes |
| `transaction:updated {transaction}` | `[TransactionsCache.Key, tx.id]` | `transactionsCache.upsert(tx)`; **UNCONDITIONALLY** invalidate `['unacknowledged-transactions-count']` (payload drops `previous_acknowledgment_status`) | yes |
| `account:updated {account, op:'created'\|'updated'}` | `[AccountsCache.Key]` | `accountsCache.upsert(account)` (dedupe by id; `op` ignored — both upsert) | yes |
| `account:updated {account, op:'balance'}` | `[AccountsCache.Key]` | `accountsCache.updateSparkAccountBalance({accountId: account.id, balance: account.balance})` — version-IGNORING; routing through `upsert` would silently drop it | **no (equality-guarded)** |
| `user:updated {user}` | `['user']` (`UserCache.Key`) | `userCache.set(user)` — unconditional overwrite (no version) | no |
| `contact:created {contact}` | `['contacts']` (`ContactsCache.Key`) | `contactsCache.add(contact)` (dedupe-by-id — see Task 8) | no |
| `contact:deleted {contactId}` | `['contacts']` | `contactsCache.remove(contactId)` (filter by id) | no |
| `receive:completed {quoteId, transactionId, amount, protocol}` | `[Cashu/SparkReceiveQuoteCache.Key, quoteId]` + `[TransactionsCache.Key, transactionId]` | refetch the per-quote key via `sdk.{protocol}.receive.get(quoteId)`; `transactionsCache.invalidateTransaction(transactionId)` | refetch (monotonic) |
| `receive:expired {quoteId, protocol}` | `[…ReceiveQuoteCache.Key, quoteId]` | refetch the per-quote key | refetch |
| `receive:failed {quoteId, error, protocol}` | `[…ReceiveQuoteCache.Key, quoteId]` | refetch the per-quote key; surface `error` → toast (background-task: log only) | refetch |
| `send:pending {quoteId, transactionId, protocol}` | cashu-swap: `['cashu-send-swap', quoteId]`; else transaction | cashu-SWAP: refetch via `sdk.cashu.send.get`. cashu-LN-send + spark: rely on `transaction:*` (no per-quote read) | refetch |
| `send:completed {quoteId, transactionId, amount, protocol}` | per-quote (swap only) + transaction | swap: refetch `sdk.cashu.send.get`; transaction handled by `transaction:*`; balance via `account:updated` | refetch |
| `send:failed {quoteId, error, protocol}` | per-quote (swap only) | swap: refetch `sdk.cashu.send.get`; `error` → toast | refetch |
| `auth:signed-in {user}` | — | STUB through S13 (auth stays on OpenSecret). Forward-compatible no-op + comment | — |
| `auth:signed-out {}` | — | STUB through S13 | — |
| `auth:session-expired {}` | — | STUB (no SDK producer yet) | — |
| `background:state {state}` | — | optional `console.debug`/diagnostic only; no cache op | — |
| `realtime:connected {}` (NEW — Task 5) | the recovered key set | invalidate `['user']`, `['accounts']`, `['contacts']`, `[TransactionsCache.AllTransactionsKey]` (+ active per-quote keys) to recover updates missed while offline (replaces today's `onConnected` 13-cache fan) | — |

> **send:*/receive:* carry NO entity and NO version** → the bridge MUST refetch via `sdk.{cashu,spark}.{send,receive}.get` (monotonic by construction), never `setQueryData` from the payload. Version-aware `setQueryData` applies ONLY to `transaction:*`/`account:updated` (which carry versioned entities). The cashu LN-send + spark send screens have NO per-quote read — they observe the transaction they navigated to (driven by `transaction:*`).

---

## Reconnect & activity-tracking (the missing-update recovery — D13-6)

Today (`use-track-wallet-changes.ts`): the web subscribes the `wallet:<userId>` channel and registers an `onConnected` that invalidates 13 caches to recover updates missed while realtime was down; `wallet.tsx:55` `useSupabaseRealtimeActivityTracking` drives `setOnlineStatus`/`setActiveStatus` from `window` online/offline + `document` visibility.

After S13 the SDK owns realtime. The `SupabaseRealtimeManager.subscribe(topic, onConnected?)` ALREADY supports an `onConnected` callback (fires on initial connect AND reconnect — `supabase-realtime-manager.ts:159,581`), and ALREADY has `setOnlineStatus`/`setActiveStatus` (`:334,357`). The forwarder just doesn't pass `onConnected`, and nothing wires `window`/`document` listeners. Task 5 closes both gaps: emit a `realtime:connected` SDK event from the forwarder's `onConnected`, and expose a connectivity setter so a thin web hook can keep driving online/active.

---

## File Structure

**SDK — created/modified (Tasks 1–5; web untouched):**
- Modify `packages/wallet-sdk/src/index.ts` — barrel: add account value-helper exports + `CashuLightningQuote`/`SparkLightningQuote` types.
- Modify `packages/wallet-sdk/src/types/account-config.ts` — `AddAccountConfig.cashu` gains `purpose?`+`expiresAt?`.
- Modify `packages/wallet-sdk/src/domains/accounts/accounts-domain.ts` — `add` honors `purpose`/`expiresAt`.
- Modify `packages/wallet-sdk/src/domains.ts` — add `previewLightningQuote` to `CashuSendOps`+`SparkSendOps`.
- Modify `packages/wallet-sdk/src/domains/cashu/cashu-domain.ts` + `spark/spark-domain.ts` — implement `previewLightningQuote`.
- Modify `packages/wallet-sdk/src/events.ts` — `account:updated.op` += `'balance'`; add `'realtime:connected'`.
- Modify `packages/wallet-sdk/src/internal/orchestrator/spark-balance-listener.ts` — emit `op:'balance'`.
- Modify `packages/wallet-sdk/src/internal/realtime/wallet-changes-forwarder.ts` — pass `onConnected` → emit `realtime:connected`; expose connectivity passthrough.
- Modify `packages/wallet-sdk/src/domains/background/background-domain.ts` (+ `internal/background/background-runner.ts`) — wire forwarder `onConnected`; add a `setConnectivity` passthrough on the `BackgroundDomain` (for the web activity hook).
- Modify `packages/wallet-sdk/src/domains.ts` `BackgroundDomain` interface — add `setConnectivity({online, active})`.
- Each SDK change gets/extends its co-located `*.test.ts`.

**Web — created (Task 7):**
- `apps/web-wallet/app/features/wallet/use-sdk-event-bridge.ts` — the ONE `useSdkEventBridge()` hook implementing the §5 table.

**Web — modified (Tasks 6, 8):**
- `apps/web-wallet/app/features/accounts/account-hooks.ts` — accounts READ flip (Task 6); re-point `Account`/wallet types.
- `apps/web-wallet/app/features/accounts/account.ts` (+ `~/lib/cashu/utils.ts` consumers) — re-point `Account`/`ExtendedCashuWallet` to the barrel (Task 6).
- `apps/web-wallet/app/features/receive/claim-cashu-token-service.ts` + its route factory `app/routes/_protected.receive.cashu_.token.tsx` — thread `sdk` (Task 6).
- `apps/web-wallet/app/features/wallet/wallet.tsx` — mount bridge + background start/stop; drop processor/realtime/balance lines (Task 8).
- The write-mutation hooks in `send/`, `receive/`, `transfer/`, `user/`, `contacts/`, `transactions/`, `accounts/` (Task 8).
- `apps/web-wallet/app/root.tsx` — remove the `SupabaseRealtimeError` ErrorBoundary branch (Task 8).

**Web — deleted (Task 8 — exact list in that task):** `features/wallet/task-processing.ts`, `task-processing-lock-repository.ts`, `use-track-wallet-changes.ts`; `lib/supabase/*`; all `*ChangeHandlers` + `{Entity}Cache` classes the bridge replaces; `shared/cashu.ts`, `shared/spark.ts` wallet/balance logic; `database.client.ts` realtime client; `entry.client.tsx` `configure()`; the 6 `useProcess*Tasks` + WS-subscription hooks.

**Not touched (auth stays — D13-1):** `features/user/auth.ts` (`authQueryOptions`/`useAuthState`/`useHandleSessionExpiry`/`useAuthActions`), `features/shared/auth.ts` `isLoggedIn`, `_auth.tsx`/`_protected.tsx` guards, `features/agicash-db/supabase-session.ts`, feature-flags.

---

## PREP — Task 1: Barrel-export the account value helpers (SDK, additive)

**Files:**
- Modify: `packages/wallet-sdk/src/index.ts`
- Test: `packages/wallet-sdk/src/index.test.ts` (or the existing barrel test if present; else add a focused one)

**Interfaces:**
- Produces: `getAccountBalance(account): Money | null`, `getExtendedAccounts(user, accounts)`, `isDefaultAccount(user, account)`, `canSendToLightning(account)`, `canReceiveFromLightning(account)` — all re-exported from `@agicash/wallet-sdk` (they already exist in `domains/accounts/account-utils.ts`, verified). These unblock the web accounts read-flip (Task 6) and let the web stop duplicating `account-utils`.

- [ ] **Step 1: Add the value-helper exports** — in `packages/wallet-sdk/src/index.ts`, after the accounts type block (`:62-80`), add:

```ts
// --- accounts value helpers (pure; consumed by the thin web read-model) ------
export {
  getAccountBalance,
  getExtendedAccounts,
  isDefaultAccount,
  canSendToLightning,
  canReceiveFromLightning,
} from './domains/accounts/account-utils';
```

> `getAccountBalance` returns `Money | null` (null for an offline spark account) — NOT `AccountsDomain.getBalance` which throws `ACCOUNT_OFFLINE`. The web `useBalance` relies on the null-skip, so the null-returning helper is the one to export.

- [ ] **Step 2: Write the failing test** — in the SDK barrel test, assert the helpers are exported as functions:

```ts
import * as sdk from './index';

test('barrel exports the account value helpers', () => {
  expect(typeof sdk.getAccountBalance).toBe('function');
  expect(typeof sdk.getExtendedAccounts).toBe('function');
  expect(typeof sdk.isDefaultAccount).toBe('function');
  expect(typeof sdk.canSendToLightning).toBe('function');
  expect(typeof sdk.canReceiveFromLightning).toBe('function');
});
```

- [ ] **Step 3: Run** — `bun --filter=@agicash/wallet-sdk run test -- index` → PASS.
- [ ] **Step 4: Gate** — `bun run fix:all && bun run typecheck && bun --filter=@agicash/wallet-sdk run test`.
- [ ] **Step 5: Commit** — `feat(wallet-sdk): export account value helpers from the barrel (S13 prep)`.

---

## PREP — Task 2: `AddAccountConfig` gains `purpose`/`expiresAt` (SDK, additive)

**Files:**
- Modify: `packages/wallet-sdk/src/types/account-config.ts`
- Modify: `packages/wallet-sdk/src/domains/accounts/accounts-domain.ts`
- Test: `packages/wallet-sdk/src/domains/accounts/accounts-domain.test.ts`

**Interfaces:**
- Produces: `AddAccountConfig.cashu` accepts optional `purpose?: AccountPurpose` and `expiresAt?: string | null`; `accounts.add` persists them (offer keyset-expiry derivation). Spark stays `transactional`. Unblocks the web `useAddCashuAccount` flip (gift-card/offer) in Task 8.

- [ ] **Step 1: Extend the config type** — in `account-config.ts`, change the cashu variant:

```ts
import type { Account, AccountPurpose } from './account';
// ...
export type AddAccountConfig =
  | {
      type: 'cashu';
      mintUrl: string;
      currency: Currency;
      name?: string;
      /** Defaults to 'transactional'. 'gift-card'/'offer' for special-purpose mints. */
      purpose?: AccountPurpose;
      /** Offer accounts expire at the keyset expiry; null/omitted = never. */
      expiresAt?: string | null;
    }
  | { type: 'spark'; currency: Currency; name?: string };
```

- [ ] **Step 2: Write the failing test** — in `accounts-domain.test.ts`, assert add persists purpose+expiry (use the existing fake `AccountRepository` pattern in that test; capture the `create` arg):

```ts
test('add persists a non-transactional cashu purpose + expiresAt', async () => {
  const created = await domain.add({
    type: 'cashu',
    mintUrl: 'https://mint.example',
    currency: 'BTC',
    purpose: 'gift-card',
    expiresAt: '2030-01-01T00:00:00.000Z',
  });
  expect(createSpy).toHaveBeenCalledWith(
    expect.objectContaining({ purpose: 'gift-card', expiresAt: '2030-01-01T00:00:00.000Z' }),
  );
  expect(created.purpose).toBe('gift-card');
});

test('add defaults cashu purpose to transactional / expiresAt null', async () => {
  await domain.add({ type: 'cashu', mintUrl: 'https://mint.example', currency: 'BTC' });
  expect(createSpy).toHaveBeenCalledWith(
    expect.objectContaining({ purpose: 'transactional', expiresAt: null }),
  );
});
```

- [ ] **Step 3: Run → FAIL** — `bun --filter=@agicash/wallet-sdk run test -- accounts-domain`.
- [ ] **Step 4: Implement** — in `accounts-domain.ts` `add`, the cashu branch:

```ts
if (config.type === 'cashu') {
  created = await accounts.create({
    userId,
    type: 'cashu',
    name: config.name ?? 'Cashu',
    currency: config.currency,
    purpose: config.purpose ?? 'transactional',
    expiresAt: config.expiresAt ?? null,
    mintUrl: config.mintUrl,
    isTestMint: checkIsTestMint(config.mintUrl),
  });
}
```

> Offer-account keyset-expiry derivation (the web `account-service.addCashuAccount` computes `expiresAt` from the mint keyset for `purpose:'offer'`) is the CALLER's responsibility today — the web passes a concrete `expiresAt`. Keep that contract: `accounts.add` persists what it's given; the offer-expiry derivation stays where the offer flow computes it (carried into the Task 8 web flip). Do NOT move keyset I/O into `accounts.add`.

- [ ] **Step 5: Run → PASS.** Gate: `bun run fix:all && bun run typecheck && bun --filter=@agicash/wallet-sdk run test`.
- [ ] **Step 6: Commit** — `feat(wallet-sdk): AddAccountConfig honors cashu purpose/expiresAt (S13 prep)`.

---

## PREP — Task 3: `previewLightningQuote` (SDK, additive) — fee preview without persisting

**Files:**
- Modify: `packages/wallet-sdk/src/domains.ts` (`CashuSendOps` + `SparkSendOps`)
- Modify: `packages/wallet-sdk/src/domains/cashu/cashu-domain.ts`, `domains/spark/spark-domain.ts`
- Modify: `packages/wallet-sdk/src/index.ts` (export the preview types)
- Test: `packages/wallet-sdk/src/domains/cashu/cashu-domain.test.ts`, `spark/spark-domain.test.ts`

**Interfaces:**
- Produces: `sdk.cashu.send.previewLightningQuote({account, destination, amount?}): Promise<CashuLightningQuote>` and `sdk.spark.send.previewLightningQuote({account, destination, amount?}): Promise<SparkLightningQuote>` — resolve the destination + quote fees but DO NOT persist. The web confirmation screen renders fees off this; `createLightningQuote` (persist) + `executeQuote` run on confirm. `CashuLightningQuote` (`cashu-send-quote-service.ts:42`) and `SparkLightningQuote` (`spark-send-quote-service.ts:13`) carry `amountRequested`/`amountToReceive`/`estimatedTotalFee`/`estimatedTotalAmount`.

- [ ] **Step 1: Declare on the interfaces** — in `domains.ts` `CashuSendOps` (before `createLightningQuote` at `:160`):

```ts
  /**
   * Preview a LIGHTNING send (fees + amounts) WITHOUT persisting or reserving
   * proofs — for the confirmation screen. `createLightningQuote` + `executeQuote`
   * run on confirm. Same params as `createLightningQuote`.
   */
  previewLightningQuote(params: {
    account: CashuAccount;
    destination: string;
    amount?: Money;
  }): Promise<CashuLightningQuote>;
```

and the analogous block in `SparkSendOps` returning `SparkLightningQuote`. Add the type imports at the top of `domains.ts`:

```ts
import type { CashuLightningQuote } from './domains/cashu/cashu-send-quote-service';
import type { SparkLightningQuote } from './domains/spark/spark-send-quote-service';
```

- [ ] **Step 2: Export the preview types** — in `index.ts` cashu/spark sections:

```ts
export type { CashuLightningQuote } from './domains/cashu/cashu-send-quote-service';
export type { SparkLightningQuote } from './domains/spark/spark-send-quote-service';
```

- [ ] **Step 3: Write failing tests** — in `cashu-domain.test.ts`, assert preview returns a quote WITHOUT a persisted id / without calling the repo's create. Mirror the existing `createLightningQuote` test setup; spy on `sendQuoteRepo.create` (or the service's `createSendQuote`) and assert it is NOT called:

```ts
test('previewLightningQuote quotes fees without persisting', async () => {
  const preview = await domain.send.previewLightningQuote({
    account: cashuAccount,
    destination: bolt11,
  });
  expect(preview.estimatedTotalFee).toBeInstanceOf(Money);
  expect(createSendQuoteSpy).not.toHaveBeenCalled();
});
```

(analogous spark test with `getLightningSendQuote`/`createSendQuote`.)

- [ ] **Step 4: Run → FAIL.**
- [ ] **Step 5: Implement (cashu)** — in `cashu-domain.ts` `send`, add `previewLightningQuote` by factoring the pre-persist half of `createLightningQuote`:

```ts
async previewLightningQuote({ account, destination, amount }) {
  const { paymentRequest } = await resolveDestination(destination, amount);
  return sendQuoteService.getLightningQuote({ account, paymentRequest, amount });
},
```

(`getLightningQuote` already returns `CashuLightningQuote`.) **Spark** — in `spark-domain.ts` `send`, mirror the amount→BTC conversion + `resolveDestination` then return `sendQuoteService.getLightningSendQuote({account, paymentRequest, amount: amountBtc})` (which returns `SparkLightningQuote`). Extract the shared amount-conversion + resolve into a local helper so `previewLightningQuote` and `createLightningQuote` share it (DRY).

- [ ] **Step 6: Run → PASS.** Gate: SDK suite + typecheck + fix:all.
- [ ] **Step 7: Commit** — `feat(wallet-sdk): add send.previewLightningQuote (ephemeral fee preview) (S13 prep)`.

---

## PREP — Task 4: `account:updated` balance discriminator (SDK, additive)

**Files:**
- Modify: `packages/wallet-sdk/src/events.ts`
- Modify: `packages/wallet-sdk/src/internal/orchestrator/spark-balance-listener.ts`
- Test: `packages/wallet-sdk/src/internal/orchestrator/spark-balance-listener.test.ts`

**Interfaces:**
- Produces: `account:updated` payload `op` is now `'created' | 'updated' | 'balance'`. The `SparkBalanceListener` emits `op:'balance'` (balance-only, same version); the `WalletChangesForwarder` keeps emitting `'created'`/`'updated'` (full versioned rows). The bridge (Task 7) routes `op:'balance'` → `updateSparkAccountBalance`.

- [ ] **Step 1: Extend the event op union** — in `events.ts`:

```ts
  /** An account was created, updated (full row), or had a balance-only refresh. */
  'account:updated': {
    account: Account;
    op: 'created' | 'updated' | 'balance';
  };
```

- [ ] **Step 2: Update the failing test** — in `spark-balance-listener.test.ts`, change the emit assertion to expect `op:'balance'`:

```ts
expect(emitted).toEqual(
  expect.objectContaining({ account: expect.objectContaining({ id: account.id }), op: 'balance' }),
);
```

- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** — in `spark-balance-listener.ts` `refreshBalance`, change the emit:

```ts
this.deps.emitter.emit('account:updated', { account: updated, op: 'balance' });
```

- [ ] **Step 5: Run → PASS.** Confirm the forwarder still emits `'created'`/`'updated'` (no change there) and `wallet-changes-forwarder.test.ts` stays green.
- [ ] **Step 6: Gate** — SDK suite + typecheck + fix:all (the union widening is backward-compatible: existing `'created'/'updated'` consumers still typecheck).
- [ ] **Step 7: Commit** — `feat(wallet-sdk): add account:updated op:'balance' for balance-only spark refreshes (S13 prep)`.

---

## PREP — Task 5: `realtime:connected` event + connectivity passthrough (SDK, additive)

**Files:**
- Modify: `packages/wallet-sdk/src/events.ts`
- Modify: `packages/wallet-sdk/src/internal/realtime/wallet-changes-forwarder.ts`
- Modify: `packages/wallet-sdk/src/internal/background/background-runner.ts`, `domains/background/background-domain.ts`, `domains.ts` (`BackgroundDomain`)
- Test: `packages/wallet-sdk/src/internal/realtime/wallet-changes-forwarder.test.ts`, `domains/background/background-domain.test.ts`

**Interfaces:**
- Produces: a new `'realtime:connected': Record<string, never>` SDK event, emitted whenever the `wallet:<userId>` channel (re)connects (initial + reconnect). And `sdk.background.setConnectivity({online, active})` so the web can keep driving the realtime manager's `setOnlineStatus`/`setActiveStatus`. The bridge (Task 7) listens to `realtime:connected` to re-invalidate the recovered key set; the thin web activity hook (Task 8) calls `setConnectivity`.

- [ ] **Step 1: Add the event** — in `events.ts`:

```ts
  /** The realtime channel (re)connected; consumers should refetch to recover any updates missed while disconnected. */
  'realtime:connected': Record<string, never>;
```

- [ ] **Step 2: Emit it from the forwarder's onConnected** — in `wallet-changes-forwarder.ts` `start`, pass an `onConnected` to `subscribe` (the manager already supports it — `supabase-realtime-manager.ts:162`):

```ts
this.deps.realtime.addChannel(builder);
this.topic = builder.topic;
await this.deps.realtime.subscribe(this.topic, () => {
  this.deps.emitter.emit('realtime:connected', {});
});
```

> The manager invokes the `onConnected` callback on the INITIAL subscribe and on every reconnect (`subscribe-callback` SUBSCRIBED branch, `:581`). When `stop()` removes the channel, pass the same callback to `removeChannel({onConnected})` if it was captured — or accept the manager drops it on full removal (it does: `removeChannel` deletes the state). Keep `start()`'s `if (this.topic) return` idempotency.

- [ ] **Step 3: Add `setConnectivity` to the runner + domain** — `BackgroundRunner` holds the forwarder which holds the manager. Add a passthrough. In `background-runner.ts`:

```ts
setConnectivity({ online, active }: { online: boolean; active: boolean }): void {
  this.deps.forwarder.setConnectivity({ online, active });
}
```

and on `WalletChangesForwarder` add:

```ts
setConnectivity({ online, active }: { online: boolean; active: boolean }): void {
  this.deps.realtime.setOnlineStatus(online);
  this.deps.realtime.setActiveStatus(active);
}
```

In `background-domain.ts` return object: `setConnectivity: (c) => runner.setConnectivity(c)`. In `domains.ts` `BackgroundDomain` interface add:

```ts
  /** Forward browser online/active status to the SDK's realtime manager (catch-up resilience). */
  setConnectivity(params: { online: boolean; active: boolean }): void;
```

- [ ] **Step 4: Write failing tests** — (a) forwarder test: a fake realtime manager whose `subscribe(topic, onConnected)` immediately calls `onConnected` → assert `realtime:connected` emitted; calling `setConnectivity` calls the manager's setters. (b) background-domain test: `setConnectivity` reaches the forwarder/manager. Use DI'd fakes (NO `mock.module`).
- [ ] **Step 5: Implement → run → PASS.**
- [ ] **Step 6: Gate** — SDK suite + typecheck + fix:all.
- [ ] **Step 7: Commit** — `feat(wallet-sdk): emit realtime:connected on (re)connect + background.setConnectivity (S13 prep)`.

---

## PREP — Task 6: Wallet-class unification + accounts READ flip + thread sdk into claim-cashu-token-service (web)

**Files:**
- Modify: `apps/web-wallet/app/features/accounts/account.ts` (+ `account-hooks.ts`)
- Modify: `apps/web-wallet/app/lib/cashu/utils.ts` consumers (re-point the `ExtendedCashuWallet` TYPE only)
- Modify: `apps/web-wallet/app/features/receive/claim-cashu-token-service.ts` + `app/routes/_protected.receive.cashu_.token.tsx`

**Interfaces:**
- Consumes: `useSdk` (S12), the SDK barrel account types + value helpers (Task 1), `sdk.accounts.list/get`.
- Produces: the web `Account`/`ExtendedCashuWallet` TYPE is the SDK barrel type; `useAccounts`/`useAccountOrNull`/`useBalance` read SDK-built accounts; `claim-cashu-token-service` uses `sdk` (rate cache + SDK-built source wallet).

**Why this is behavior-neutral prep:** the accounts READ flip preserves the `[AccountsCache.Key]`/`['fetch-account-by-id', id]` keys, so the still-alive `useAccountChangeHandlers` + `updateSparkAccountBalance` keep writing the SAME cache. The only change: the cache now holds SDK-built `Account`s (whose `wallet` is the SDK `ExtendedCashuWallet`, byte-identical class, same seed derivation). The web still builds its own wallets in `shared/cashu`/`shared/spark` for the still-alive money mutations until Task 8 — they run transiently on SDK-built wallets after this flip (equivalent; validated at the e2e/manual gate).

- [ ] **Step 1: Re-point the web `Account` + `ExtendedCashuWallet` TYPE to the barrel** — in `account.ts` (and wherever the web declares `Account`/`ExtendedCashuWallet`), replace the local type with `export type { Account, ExtendedAccount, CashuAccount, SparkAccount } from '@agicash/wallet-sdk'` and re-point `ExtendedCashuWallet` to the barrel. `git grep -n "ExtendedCashuWallet" apps/web-wallet/app` first — only the TYPE position needs re-pointing; VALUE constructors (`new ExtendedCashuWallet`, `getCashuWallet`) in `~/lib/cashu` stay (deleted in Task 8). `Money` + `BreezSdk` already shared (no change). The only TS2322 is the cashu `wallet` private-field nominal mismatch — re-pointing the type kills it.

- [ ] **Step 2: Flip `accountsQueryOptions`** — in `account-hooks.ts` (the DEFERRED-from-S12 step, retained in `2026-06-13-wallet-sdk-12-reads-flip.md` Task 2 as reference): `queryFn: async () => (await sdk).accounts.list()`, keep `staleTime: Infinity` + `structuralSharing` verbatim, take `{ sdk }` instead of `{ userId, accountRepository }`. Update `useAccounts` to `const sdk = useSdk();` (keep `useUser()` for the `select` closure + the refetch flags). Flip `useAccountOrNull`'s lazy fetch to `sdk.accounts.get(id)` keeping the `accountsCache.upsert` side-effect. `useBalance` keeps deriving from the cache via the now-barrel `getAccountBalance` (Task 1). (Full step-by-step in the S12 plan Task 2.)

- [ ] **Step 3: Thread `sdk` into `claim-cashu-token-service`** — it currently calls `~/lib/exchange-rate` directly (`:172`) and is constructed in the route FACTORY `getClaimCashuTokenService` (`_protected.receive.cashu_.token.tsx:39-99`, NOT a hook). Add an `sdk: Sdk` (or the exchange-rate domain + accounts) constructor dep; in the factory pass `await getSdk(domain)` (domain available in the route). Replace the direct `exchangeRateService.getRates` with `sdk.exchangeRate.getRate(...)`. Its melt uses `sourceAccount.wallet.meltProofsIdempotent` — the wallet handle is now the SDK-built live wallet from `sdk.accounts.list()`/the read flip, which has that method.

- [ ] **Step 4: Typecheck** — `bun --filter=web-wallet run typecheck`. Fix residual `Account`-type mismatches by re-pointing the offending web-local type to the barrel (never cast). Expected: PASS once `Account`/`ExtendedCashuWallet` are barrel types.
- [ ] **Step 5: Gate** — `bun run fix:all && bun run typecheck && bun --filter=web-wallet run test`. (No SDK change in this task → SDK suite optional but harmless.)
- [ ] **Step 6: Commit** — `feat(web): unify Account/ExtendedCashuWallet on the SDK + flip accounts read (S13 prep)`.

---

## PREP — Task 7: Create the `useSdkEventBridge` hook (web, UNMOUNTED)

**Files:**
- Create: `apps/web-wallet/app/features/wallet/use-sdk-event-bridge.ts`

**Interfaces:**
- Consumes: `useSdk` (S12), `sdk.events.on`, the existing `{Entity}Cache` classes (`UserCache`, `AccountsCache`, `TransactionsCache`, `ContactsCache`, `Cashu/SparkReceiveQuoteCache`, `CashuSendSwapCache`) + their `useXCache()` hooks, `useQueryClient`, `useToast`.
- Produces: `useSdkEventBridge(): void` — subscribes every `sdk.events` key to its §5 cache op; mounted in Task 8. **Created here UNMOUNTED (no consumer) → behavior-neutral.**

**Implementation** — the hook resolves the SDK (await once in an effect), then registers `on(...)` handlers per the §5 table, storing every teardown and cleaning up on unmount. Skeleton (the executing subagent fills each handler using the EXISTING cache-class methods — verify each method signature in its `*-hooks.ts`):

- [ ] **Step 1: Write the hook**

```ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Sdk } from '@agicash/wallet-sdk';
import { useSdk } from '~/features/shared/use-sdk';
import { useAccountsCache } from '~/features/accounts/account-hooks';
import { useTransactionsCache } from '~/features/transactions/transaction-hooks';
import { useContactsCache } from '~/features/contacts/contact-hooks';
import { useUserCache } from '~/features/user/user-hooks';
// + the per-quote cache Keys (CashuReceiveQuoteCache, SparkReceiveQuoteCache, CashuSendSwapCache)

/**
 * The single SDK-events → TanStack-cache bridge (spec §5). Replaces every web
 * realtime change-handler + the per-quote trackers' live updates. Mounted once
 * in `Wallet` (all protected tabs, NOT leader-gated). The SDK owns reactivity;
 * this maps each event to a cache op against the SAME query keys S12 preserved.
 */
export function useSdkEventBridge(): void {
  const sdkPromise = useSdk();
  const queryClient = useQueryClient();
  const accountsCache = useAccountsCache();
  const transactionsCache = useTransactionsCache();
  const contactsCache = useContactsCache();
  const userCache = useUserCache();

  useEffect(() => {
    let teardowns: Array<() => void> = [];
    let disposed = false;

    void sdkPromise.then((sdk: Sdk) => {
      if (disposed) return;
      const on = sdk.events.on.bind(sdk.events);

      teardowns.push(
        on('transaction:created', ({ transaction }) => {
          transactionsCache.upsert(transaction);
          if (transaction.acknowledgmentStatus === 'pending') {
            queryClient.invalidateQueries({ queryKey: ['unacknowledged-transactions-count'] });
          }
        }),
        on('transaction:updated', ({ transaction }) => {
          transactionsCache.upsert(transaction);
          queryClient.invalidateQueries({ queryKey: ['unacknowledged-transactions-count'] });
        }),
        on('account:updated', ({ account, op }) => {
          if (op === 'balance' && account.type === 'spark') {
            accountsCache.updateSparkAccountBalance({ accountId: account.id, balance: account.balance });
          } else {
            accountsCache.upsert(account);
          }
        }),
        on('user:updated', ({ user }) => userCache.set(user)),
        on('contact:created', ({ contact }) => contactsCache.add(contact)),
        on('contact:deleted', ({ contactId }) => contactsCache.remove(contactId)),

        // per-quote receive trackers: refetch the SAME key S12 reads (sdk.*.receive.get)
        on('receive:completed', ({ quoteId, transactionId, protocol }) => {
          refetchReceiveQuote(queryClient, protocol, quoteId);
          transactionsCache.invalidateTransaction(transactionId);
        }),
        on('receive:expired', ({ quoteId, protocol }) => refetchReceiveQuote(queryClient, protocol, quoteId)),
        on('receive:failed', ({ quoteId, protocol /*, error */ }) => refetchReceiveQuote(queryClient, protocol, quoteId)),

        // cashu send-swap active screen (the only per-quote SEND read): refetch sdk.cashu.send.get
        on('send:pending', ({ quoteId, protocol }) => refetchCashuSendSwapIfPresent(queryClient, protocol, quoteId)),
        on('send:completed', ({ quoteId, protocol }) => refetchCashuSendSwapIfPresent(queryClient, protocol, quoteId)),
        on('send:failed', ({ quoteId, protocol /*, error */ }) => refetchCashuSendSwapIfPresent(queryClient, protocol, quoteId)),

        // catch-up after reconnect (replaces use-track-wallet-changes onConnected 13-cache fan)
        on('realtime:connected', () => {
          queryClient.invalidateQueries({ queryKey: ['user'] });
          queryClient.invalidateQueries({ queryKey: ['accounts'] });
          queryClient.invalidateQueries({ queryKey: ['contacts'] });
          queryClient.invalidateQueries({ queryKey: ['all-transactions'] });
        }),

        // auth events — STUB through S13 (auth stays on OpenSecret, D13-1)
        on('auth:signed-in', () => {/* auth-slice */}),
        on('auth:signed-out', () => {/* auth-slice */}),
        on('auth:session-expired', () => {/* no SDK producer yet; auth-slice */}),
      );
    });

    return () => {
      disposed = true;
      for (const t of teardowns) t();
      teardowns = [];
    };
  }, [sdkPromise, queryClient, accountsCache, transactionsCache, contactsCache, userCache]);
}
```

> `refetchReceiveQuote`/`refetchCashuSendSwapIfPresent` are small local helpers: `queryClient.invalidateQueries({ queryKey: [<Cache>.Key, quoteId] })` against the cache Key the S12-flipped trackers / the Task-8 send-swap read use. The subagent must confirm each cache method name (`upsert`/`set`/`add`/`remove`/`updateSparkAccountBalance`/`invalidateTransaction`) by reading the existing cache classes, and that `useUserCache`/`useContactsCache` etc. exist (they're exported from the entity `*-hooks` files — verify and adjust import names). DO NOT add `useToast` error toasts here for background tasks (spec: background → log only); the active-flow screens drive their own toasts from their Zustand stores.

- [ ] **Step 2: Typecheck** — `bun --filter=web-wallet run typecheck`. The hook is exported but unused (no mount) — biome `noUnusedExports`/`noUnusedImports` won't flag an exported hook. Expected: PASS.
- [ ] **Step 3: Gate** — `bun run fix:all && bun run typecheck && bun --filter=web-wallet run test`. Behavior unchanged (unmounted).
- [ ] **Step 4: Commit** — `feat(web): add useSdkEventBridge (unmounted) implementing the §5 event→cache table (S13 prep)`.

---

## ATOMIC — Task 8: The orchestration flip (ONE commit)

> **This is the cut-over. It is necessarily one commit (D13-2, spec §8/§9): the moment the web processor is deleted, `sdk.background.start()` must be live, the bridge mounted, and the money writes flipped — no intermediate state may run two leaders or two cache drivers.** Execute ALL steps, gate, then make the SINGLE commit in the last step. A capable model (opus) should run this task end-to-end.

**Files:** `wallet.tsx`, `root.tsx`, the write-mutation hooks across `send/`/`receive/`/`transfer/`/`user/`/`contacts/`/`transactions/`/`accounts/`, `entry.client.tsx`; deletions per the checklist below.

**Interfaces:**
- Consumes: everything from Tasks 1–7 (preview ops, AddAccountConfig, the bridge, the events, the unified accounts read).

### 8.1 — Mount the bridge + background lifecycle in `Wallet`

- [ ] **Step 1: Rewrite `wallet.tsx`** — replace the realtime/balance/processor block (`:54-62`) and drop the now-dead imports:

```tsx
import { type PropsWithChildren, useEffect } from 'react';
import * as Sentry from '@sentry/react-router';
import { useToast } from '~/hooks/use-toast';
import { useTheme } from '../theme';
import { useHandleSessionExpiry } from '../user/auth';
import { useUser } from '../user/user-hooks';
import { useSdk } from '../shared/use-sdk';
import { useSdkEventBridge } from './use-sdk-event-bridge';
import { useRealtimeConnectivity } from './use-realtime-connectivity'; // thin activity hook (step 2)

// useSyncThemeWithDefaultCurrency unchanged

export const Wallet = ({ children }: PropsWithChildren) => {
  const { toast } = useToast();
  const user = useUser();
  const sdkPromise = useSdk();

  useEffect(() => {
    Sentry.setUser({ id: user.id, username: user.username, isGuest: user.isGuest, defaultCurrency: user.defaultCurrency });
  }, [user]);

  useHandleSessionExpiry({ /* unchanged — auth stays on OpenSecret (D13-1) */ });
  useSyncThemeWithDefaultCurrency();

  // SDK reactivity (replaces useTrackWalletChanges + useTrackAndUpdateSparkAccountBalances).
  useSdkEventBridge();
  useRealtimeConnectivity();

  // SDK background orchestration (replaces useTakeTaskProcessingLead + <TaskProcessor/>).
  // start/stop keyed on the authed user; start() parks in 'starting' if no session,
  // and does NOT auto-recover, so re-issue stop()->start() on user change (D13-9).
  useEffect(() => {
    let sdkRef: Awaited<typeof sdkPromise> | undefined;
    void sdkPromise.then((sdk) => { sdkRef = sdk; sdk.background.start(); });
    return () => { sdkRef?.background.stop(); };
  }, [sdkPromise, user.id]);

  return <>{children}</>;
};
```

> No `isLead` branch — `start()` self-elects via the SDK's `take_lead` poll; the bridge + connectivity run on every tab.

- [ ] **Step 2: Add the thin activity hook** — create `apps/web-wallet/app/features/wallet/use-realtime-connectivity.ts` porting the old `useSupabaseRealtimeActivityTracking` logic onto `sdk.background.setConnectivity` (Task 5): `window` `online`/`offline` + `document` `visibilitychange`/`focus` → `setConnectivity({online: navigator.onLine, active: !document.hidden})`. Guard for SSR (`typeof window`). It awaits `useSdk()` like the bridge.

### 8.2 — Flip the money write mutations

For each, change the `mutationFn` to the SDK call and REMOVE the `onSuccess setQueryData` blocks the bridge now owns (keep the per-quote in-flight guard, D13-10; keep Zustand-store/navigation side-effects). Apply the verified per-hook map (read each hook; the SDK signatures are in §"write methods" of the grounding):

- [ ] **Step 3: cashu send** (`send/cashu-send-quote-hooks.ts`): preview screen → `sdk.cashu.send.previewLightningQuote`; confirm → `sdk.cashu.send.createLightningQuote` then `sdk.cashu.send.executeQuote(quote)`. Delete the web `createSendQuote`/`initiateSend` split + the `useProcessCashuSendQuoteTasks`/`useOnMeltQuoteStateChange` usage (deleted in 8.5). `executeQuote` surfaces `DomainError`/`SdkError` — keep the onError toast but broaden the check to `error instanceof DomainError || error instanceof SdkError` (grounding risk).
- [ ] **Step 4: spark send** (`send/spark-send-quote-hooks.ts`): same shape with `sdk.spark.send.previewLightningQuote`/`createLightningQuote`/`executeQuote`.
- [ ] **Step 5: cashu/spark receive create** (`receive/cashu-receive-quote-hooks.ts`, `spark-receive-quote-hooks.ts`): `useCreate*ReceiveQuote` → `sdk.cashu.receive.createLightningQuote({account, amount, purpose})` / `sdk.spark.receive.createLightningQuote({account, amount, description?, purpose?})`. Keep the `onSuccess cache.add()` optimistic seed (the active screen reads it before first refetch — grounding gotcha), but the live UNPAID→PAID now flows via the bridge `receive:*` refetch (the S12-flipped read).
- [ ] **Step 6: token receive** (`receive/receive-cashu-token-hooks.ts`, `claim-cashu-token-service.ts`, `cashu-receive-swap-hooks.ts` same-mint): collapse the web `claimTokenMutation` + `useCreateCrossAccountReceiveQuotes` + same-mint `useCreateCashuReceiveSwap` into `sdk.cashu.receive.receiveToken({ token: encodeToken(claimableToken, {removeDleq:true}), destinationAccount })`. The interactive add-unknown-destination-mint + set-default stay consumer-side: `sdk.accounts.add(...)` (Task 2 purpose support) + `sdk.accounts.setDefault(...)` BEFORE `receiveToken`. Navigate using the union's `transactionId` (handle all three branches — grounding risk).
- [ ] **Step 7: transfers** (`transfer/transfer-hooks.ts`): `sdk.transfers.createQuote({sourceAccount, destinationAccount, amount})` (preview) → `sdk.transfers.executeQuote(quote)` (persists paired legs; send leg driven by the background orchestrator — do NOT add a foreground send kick, grounding fork). Status reconstructs from the two `transaction:*` events (no `transfer:*`).

### 8.3 — Flip the non-money write mutations

- [ ] **Step 8:** `useUpdateUser`→`sdk.user.updateUsername`; `acceptTerms`→`sdk.user.acceptTerms({wallet?, giftCardMint?})` (BOOLEANS — map `walletTerms`/`giftCardTerms`, do NOT pass timestamps); `setDefaultCurrency`→`sdk.user.setDefaultCurrency`; `useSetDefaultAccount`→`sdk.accounts.setDefault(account)` (returns void → drop the onSuccess setQueryData, bridge `user:updated` drives it); `useAddCashuAccount`→`sdk.accounts.add({type:'cashu', mintUrl, currency, purpose, expiresAt})` (Task 2; keep the offer keyset-expiry derivation web-side computing `expiresAt`); `useCreateContact`→`sdk.contacts.add({username})`; `useDeleteContact`→`sdk.contacts.remove(contact)` (full Contact — callers have it); `useAcknowledgeTransaction`→`sdk.transactions.acknowledge(transaction)` (full object; drop optimistic onSuccess, bridge `transaction:updated` drives it). **Do NOT flip `verifyEmail`/email mutations** — those are `sdk.auth.*` and belong to the auth slice (D13-1); they stay on the web `useAuthActions`.

### 8.4 — Flip the cashu send-swap READ (coupled to its bridge op)

- [ ] **Step 9:** in `send/cashu-send-swap-hooks.ts`, flip `useCashuSendSwap`/`useTrackCashuSendSwap`'s `queryFn` from `cashuSendSwapRepository.get` to `(await sdk).cashu.send.get(id)` (returns `CashuSendQuote | CashuSendSwap`; narrow to the swap). Keep the `['cashu-send-swap', id]` key + `staleTime: Infinity`. This MUST land here (not prep) — the bridge's `send:*` refetch drives its live state once `CASHU_SEND_SWAP_UPDATED`'s change-handler is deleted.

### 8.5 — Delete the web orchestration/reactivity/connection stack

- [ ] **Step 10: Delete files** (verify no remaining importers with `git grep` before each; keep `supabase-session.ts` — D13-1):
  - `features/wallet/task-processing.ts`, `task-processing-lock-repository.ts`, `use-track-wallet-changes.ts`
  - `lib/supabase/index.ts`, `supabase-realtime-manager.ts`, `supabase-realtime-channel.ts`, `supabase-realtime-channel-builder.ts`, `supabase-realtime-hooks.ts`
  - `shared/spark.ts` (`useTrackAndUpdateSparkAccountBalances` + wallet/balance lifecycle), `shared/cashu.ts` (wallet/seed/mint-auth — confirm no value consumer survives; `~/lib/cashu` value constructors die with their last importer), `agicash-mint-auth-provider.ts`
  - the realtime client construction in `database.client.ts` (`agicashRealtimeClient`)

- [ ] **Step 11: Prune within surviving files:** delete the 6 `useProcess*Tasks`, `useOn{Mint,Melt,SparkSend,SparkReceive}…StateChange`, every `use*ChangeHandlers`, and the `{Entity}Cache` change-handler-feeding + the now-dead list caches (`Pending*`/`Unresolved*`), from `*-quote-hooks.ts`/`*-swap-hooks.ts`/`account-hooks.ts`/`transaction-hooks.ts`/`contact-hooks.ts`/`user-hooks.tsx`. **KEEP** the active per-entity cache classes the bridge writes (`UserCache`, `AccountsCache` incl. `updateSparkAccountBalance`, `TransactionsCache`, `ContactsCache`, `Cashu/SparkReceiveQuoteCache`, `CashuSendSwapCache`) + their `useXCache` hooks + the `useCreate* onSuccess cache.add()` optimistic seeds. Surgical — each `useProcess*` file also exports cache/handler hooks; remove only the orchestration exports.

- [ ] **Step 12: Remove `entry.client.tsx` `configure()`** — the SDK's `buildConnections`→`configureOpenSecret` now owns OpenSecret configuration (S11). Remove the web's `configure({...})` call. Keep Sentry init / Money devtools / any non-SDK setup.

- [ ] **Step 13: Fix `root.tsx`** — remove the `SupabaseRealtimeError` ErrorBoundary branch (~`:263`) — its source (`supabase-realtime-hooks.ts`) is deleted; leaving the reference breaks the build.

### 8.6 — Gate + single commit

- [ ] **Step 14: Whole-task gate** — `bun run fix:all && bun run typecheck && bun --filter=web-wallet run test && bun --filter=@agicash/wallet-sdk run test`. Fix every type error (mostly dead imports + removed-symbol references). Confirm no `useTrackWalletChanges`/`useTakeTaskProcessingLead`/`TaskProcessor`/`agicashRealtimeClient` references remain: `git grep -n "useTakeTaskProcessingLead\|useTrackWalletChanges\|TaskProcessor\|agicashRealtimeClient\|useProcessCashu\|useProcessSpark" apps/web-wallet/app` → only deletions.
- [ ] **Step 15: Confirm the dual-leader invariant** — `git grep -n "take_lead\|task_processing_locks" apps/web-wallet/app` → ZERO (only the SDK polls it now). `git grep -n "sdk.background.start" apps/web-wallet/app` → only `wallet.tsx`.
- [ ] **Step 16: Commit (the one atomic commit)**

```bash
git add -A apps/web-wallet/app
git commit -m "$(cat <<'EOF'
feat(web): atomic orchestration flip — bridge + sdk.background + delete web processor (S13)

Mount the single useSdkEventBridge (sdk.events -> TanStack cache, §5 table),
start/stop sdk.background on the authed-user lifecycle, flip all send/receive/
transfer + user/contacts/transactions/accounts write mutations to sdk.*, and
flip the cashu send-swap read to sdk.cashu.send.get. Delete the web task-
processor + leader election + use-track-wallet-changes + lib/supabase realtime +
all *ChangeHandlers + the dead list caches + shared/cashu+spark wallet logic +
entry.client configure(). The web no longer polls take_lead — sdk.background is
the sole leader (spec §8 dual-leader guardrail: one atomic step). Auth stays on
OpenSecret (D13-1). Reactivity is now SDK-event-driven; reconnect catch-up via
the realtime:connected event; spark balance via account:updated op:'balance'.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## POST — Task 9: Whole-slice gate, docs, memory, carryover, e2e/manual ask

**Files:** `docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md`, this plan, the memory.

- [ ] **Step 1: Whole-slice gate** — from the worktree root: `bun run fix:all` (exit 0) + `bun run typecheck` + `bun --filter=web-wallet run test` + `bun --filter=@agicash/wallet-sdk run test`. All green.
- [ ] **Step 2: ASK the user before the real S13 gate (spec §10).** Unit/typecheck/biome do NOT prove S13 (web has no jsdom; S13 changes money paths). Request the user run / authorize: `bun run test:e2e` + manual money-path via Chrome DevTools MCP (sign-in path · cashu send + receive token/LN · spark send + receive · cross-account transfer · spark balance refresh after a receive · reconnect catch-up). Needs `VITE_BREEZ_API_KEY` + a live stack. Do NOT touch a live mint/Breez without explicit approval.
- [ ] **Step 3: Update the plan-of-plans index** — flip the Plan 13 row to ✅ done (link this plan); append the S13→S14/S15 carryover (auth-read flip is now a named pending slice; the four additive SDK changes landed; the wallet-class unification done).
- [ ] **Step 4: Commit docs** — `docs(wallet-sdk): record S13 (orchestration flip) done + S14/S15 carryover`.
- [ ] **Step 5: Update the `project-wallet-sdk-nocache-track` + `project-wallet-sdk-s13-grounding` memories** — S13 done; web fully SDK-driven on the client; auth still on OpenSecret (own slice next); next = S14 server routes + the auth slice + S15 cleanup.

**Carryover to record (S13 → auth-slice / S14 / S15):**
- **(auth slice — now the immediate next work item)** Migrate the route guards (`_auth.tsx` `login_method`/`email`, `_protected.tsx` `shouldUserVerifyEmail`/`hasUserChanged`/`ensureUserData` bootstrap) off the OpenSecret identity, re-home `Sentry.setUser`/session-hint-cookie onto the bridge's `auth:signed-in/out` (now stubbed), flip `authQueryOptions`→`sdk.user.getCurrentUser` + retire `useAuthActions`→`sdk.auth.*`. **SDK PREREQ:** add an `auth:session-expired` producer + expiry scheduler (port `useHandleSessionExpiry`), expose `login_method` (or prove it debug-only) + a cheap pre-bootstrap `isLoggedIn`/`getCurrentUserId` on the public Sdk. Delete `useHandleSessionExpiry` + `ensureUserData` in the SAME change that flips the guard (dual-bootstrap/dual-expiry-handler hazard).
- **(S14 server routes)** Unchanged from prior carryover: wire the 3 LN-address routes to `getServerSdk(domain)`; keep the LUD wire format + xchacha verify-token; delete `lightning-address-service.ts` + `database.server.ts`.
- **(S15 cleanup)** Delete the now-dead web lib copies (`~/lib/cashu` value constructors, `~/lib/exchange-rate` once its last direct importer is gone, the web `defaultAccounts` const, `~/lib/cashu/mint-validation`, leftover repos/services), `supabase-session.ts` once `database.client` is fully retired, drop unused deps, final `fix:all`.
- **(late-online spark + clientId, deferred optimizations)** `BackgroundRunner.registerBalanceListeners` snapshots accounts once at `start()`; re-register on `account:created`/`updated` if a late-online spark account proves to miss balance updates. A per-tab-stable `SdkConfig.clientId` (sessionStorage) fixes the up-to-6s zombie-lock window on remount; fold in only if it bites.

---

## Self-Review

**1. Spec coverage:**
- §5 reactive bridge (the event→cache table, version-aware apply, active-flow per-quote refresh, pre-warm kept) → the §5 table + Task 7 + Task 8.1. ✓
- §5 reconnect/pre-warm → `realtime:connected` (Task 5) + the bridge invalidate + the kept `_protected` pre-warm. ✓
- §7b "✗ web deletes" column (per-domain caches, change-handlers, processors, `useTrackAndUpdateSparkAccountBalances`, `TaskProcessor`, `useTakeTaskProcessingLead`, `use-track-wallet-changes`, realtime, OS-wrappers/encryption/shared-cashu/spark, `database.client`) → Task 8.5. ✓
- §8 dual-leader guardrail → D13-2 + Task 8 single commit + Steps 15. ✓
- §8 stale-balance `synced` re-read → owned by SDK `SparkBalanceListener` + the `op:'balance'` bridge route (Task 4 + §5 table). ✓
- §8 nutshell-#788 change refetch → preserved inside the SDK cashu orchestrator (S7/S9, not re-implemented here); Task 8.5 deletes the web WS machinery but NOT the SDK orchestrator. (Carryover note flags confirming the SDK orchestrator carries it.) ✓
- §9 atomic cut-over + the PREP/ATOMIC packaging → D13-2, Tasks 1–7 prep, Task 8 atomic. ✓
- §10 gate (e2e + manual money-path) → Task 9 Step 2 (ASK first). ✓
- Auth deferral → D13-1 + the auth-slice carryover. ✓

**2. Placeholder scan:** SDK-additive tasks (1–5) show complete code + failing tests. The bridge (Task 7) shows the full hook with every handler; the per-quote/send-swap refetch helpers are defined inline-described and gated by "confirm the cache method name by reading the class" (a verification reminder, not deferred logic). The Task 8 mutation flips are a precise per-hook map (file + current→SDK call + onSuccess disposition) with one worked pattern per protocol — the mechanical repetition across ~15 hooks is applied by reading each hook, which is honest for a cut-over of this size; the SDK signatures are all verified in the grounding/§"write methods". No "TODO"/"handle edge cases"/"similar to" placeholders.

**3. Type consistency:** `useSdkEventBridge(): void` (Task 7) is mounted in `Wallet` (Task 8.1). `previewLightningQuote` returns `CashuLightningQuote`/`SparkLightningQuote` (Task 3) consumed by the confirmation UI (Task 8.2). `account:updated.op` `'balance'` (Task 4) is matched in the bridge (Task 7). `setConnectivity` (Task 5) is called by `useRealtimeConnectivity` (Task 8.1 Step 2). `AddAccountConfig.purpose/expiresAt` (Task 2) consumed by `useAddCashuAccount` (Task 8.3). The barrel helpers (Task 1) back the accounts read-flip (Task 6) + `useBalance`.

**Risks / carryover:** the real-money guardrail is the Task-8 single commit (never two leaders). The biggest residual is the deferred auth slice (recorded). The accounts read-flip runs the still-alive web money mutations on SDK-built wallets transiently (Tasks 6→8) — equivalent classes/seed, validated at the e2e/manual gate. The `realtime:connected` + `setConnectivity` additions restore the missed-update + activity-tracking resilience that would otherwise regress.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-13-orchestration-flip.md`.**

Per the task, execution proceeds with **superpowers:subagent-driven-development** — a fresh subagent per task, two-stage review between tasks. Tasks 1–5 (SDK additive) are independent and may run in any order / parallel; Task 6 (accounts unification) and Task 7 (bridge file) are prep; **Task 8 is the atomic cut-over (one commit, opus)** and depends on all prior tasks; Task 9 is gate + docs. Per-task gate per Global Constraints. One commit per task, no push. The S13 behavioural proof (Task 9 Step 2 e2e + manual money-path) requires user authorization + a live stack.
