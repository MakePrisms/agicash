# Wallet SDK — S7a: Cashu Orchestrator Primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and unit-test (offline) every cashu orchestration *building block* the SDK needs — the 3 cashu WS subscription managers, the per-state transition handlers (incl. the nutshell-#788 change-refetch), the cashu task processors, the cross-account receive-quote service, and the cashu-token claim service — leaving the public `cashu.send.executeQuote` / `cashu.receive.receiveToken` entry points stubbed for S9 to wire.

**Architecture:** S7 is split (owner's call) into **07a (cashu, this plan)** and **07b (spark, written next)**. Per the owner's S7/S9 decision, S7 builds *primitives only*: standalone, DI-driven classes in `internal/orchestrator/` + ported WS managers in `internal/lib/cashu/`, each unit-tested with injected fakes and synthetic events (no live mint / WS / Breez). **S9** later assembles them into the leader-elected 5s poll loop and makes `executeQuote` / `receiveToken` real. Consequently the orchestrator classes here are "dark": present and fully tested, but **not yet imported by `createCashuDomain`** (the `NotImplementedError` stubs stay). This mirrors the established build-dark methodology (each slice verified by SDK unit tests alone).

**Tech Stack:** TypeScript, `bun test` (+ `bun:test` `mock`/`spyOn`), `@cashu/cashu-ts@3.6.1`, `@agicash/money`, the SDK's `SdkEventEmitter`. Package manager: `bun`/`bunx` only. CI gate per task: `bun run typecheck` + `bun run test` (NOT `fix:all`).

**Key correctness rules carried in:**
- `SdkError`/`DomainError` take **`(message, code)`**; `NotImplementedError` takes **`(method)`**.
- **Never** use bare `mock.module` (process-global, leaks into 100+ sibling tests). Use **DI'd fakes** (the orchestrators take their deps via constructor) and, where a real class prototype must be redirected, `spyOn` + `afterAll(() => mock.restore())` — the `cashu-domain.test.ts` pattern.
- Emit SDK events **only on a real state transition** (the service methods short-circuit when already in the target state; gate the emit on the returned state).
- The two §8/§10-mandated regression tests live in this slice (#788) and 07b (spark `synced`). #788 is **Task 6**.

---

## Background facts (verified against current code — do not re-derive)

**Event map** (`src/events.ts`) — payloads the orchestrator emits:
- `send:pending` `{ quoteId; transactionId; protocol: 'cashu' | 'spark' }`
- `send:completed` `{ quoteId; transactionId; amount: Money; protocol }`
- `send:failed` `{ quoteId; error: SdkError; protocol }`
- `receive:completed` `{ quoteId; transactionId; amount: Money; protocol }`
- `receive:expired` `{ quoteId; protocol }`
- `receive:failed` `{ quoteId; error: SdkError; protocol }`

There is **no** `send:created` and **no** `receive:pending`. The emitter exposed to domains is the concrete `SdkEventEmitter<SdkEventMap>` (has `.emit`); tests construct a real one and assert via `.on`.

**Cashu service transition methods** (already built in S5; the orchestrator only *calls* them — signatures verbatim):
- `CashuSendQuoteService` (`src/domains/cashu/cashu-send-quote-service.ts`):
  - `initiateSend(account: CashuAccount, sendQuote: CashuSendQuote, meltQuote: Pick<MeltQuoteBolt11Response,'quote'|'amount'>)` — guards `sendQuote.state==='UNPAID'`; calls `wallet.meltProofsIdempotent(...)`. No DB write.
  - `markSendQuoteAsPending(quote): Promise<CashuSendQuote>` — UNPAID→PENDING (no-op if already PENDING).
  - `completeSendQuote(account, sendQuote, meltQuote: MeltQuoteBolt11Response): Promise<CashuSendQuote>` — PENDING/UNPAID→PAID; **reads `meltQuote.change`** to derive change proofs (this is why #788 must refetch *before* calling it).
  - `failSendQuote(account, quote, reason): Promise<CashuSendQuote>` — guards live melt quote is UNPAID via `wallet.checkMeltQuoteBolt11`.
- `CashuSendSwapService` (`cashu-send-swap-service.ts`): `swapForProofsToSend({ account, swap })` (DRAFT→PENDING), `complete(swap)` (PENDING→COMPLETED).
- `CashuReceiveQuoteService` (`cashu-receive-quote-service.ts`): `completeReceive(account, quote): Promise<{ quote; account; addedProofs }>` (UNPAID→PAID→COMPLETED + mints), `markMeltInitiated(quote & {type:'CASHU_TOKEN'})`, `expire(quote)`, `fail(quote, reason)`, `getLightningQuote(params)`, `createReceiveQuote(params)`.
- `CashuReceiveSwapService` (`cashu-receive-swap-service.ts`): `create({ userId, token, account, reversedTransactionId? }): Promise<{ swap; account }>`, `completeSwap(account, swap): Promise<{ swap; account; addedProofs }>`.
- `SparkReceiveQuoteService` (`src/domains/spark/spark-receive-quote-service.ts`): `createReceiveQuote(params)` — already accepts the `receiveType: 'CASHU_TOKEN'` branch with `meltData`. (Used by the cross-account quote service for spark destinations.)

**Entity states:** `CashuSendQuote` = `UNPAID | PENDING | EXPIRED | FAILED | PAID`; `CashuSendSwap` = `DRAFT | PENDING | COMPLETED | FAILED | REVERSED`; `CashuReceiveQuote` = `(LIGHTNING|CASHU_TOKEN) × (UNPAID|EXPIRED|PAID|COMPLETED|FAILED)`; `CashuReceiveSwap` = `PENDING | COMPLETED | FAILED` (today a zod-inferred type in `cashu-receive-swap-repository.ts`).

**cashu-ts WS API** (on `ExtendedCashuWallet`, inherited from `Wallet`): `wallet.on.meltQuoteUpdates(ids: string[], cb, onErr): Promise<()=>void>`, `wallet.on.mintQuoteUpdates(...)`, `wallet.on.proofStateUpdates(proofs: Proof[], cb, onErr): Promise<()=>void>`, `wallet.mint.webSocketConnection?.onClose(cb)`. `wallet.checkMeltQuoteBolt11(quoteId): Promise<MeltQuoteBolt11Response>`. `wallet.getFeesForProofs(proofs): number`. `wallet.createMeltQuoteBolt11(pr): Promise<MeltQuoteBolt11Response>`. `wallet.meltProofsIdempotent(meltQuote, proofs, config?, outputType?)`.

**The web port sources** (for verbatim reference): `apps/web-wallet/app/lib/cashu/{melt-quote-subscription-manager,mint-quote-subscription-manager}.ts`; `apps/web-wallet/app/features/send/proof-state-subscription-manager.ts`; `apps/web-wallet/app/features/receive/receive-cashu-token-quote-service.ts`; `apps/web-wallet/app/features/receive/claim-cashu-token-service.ts`; the `useProcess*Tasks` / `useOn*StateChange` hooks. The web managers are **plain classes** (only the surrounding hooks are React) — the SDK port swaps the global `getCashuWallet(mintUrl)` for an injected `getWallet` and the `~/lib/utils` `isSubset` for the SDK's.

---

## File Structure

**Created:**
- `packages/wallet-sdk/src/internal/lib/sets.ts` — generic `isSubset<T>` (ported).
- `packages/wallet-sdk/src/internal/lib/cashu/melt-quote-subscription-manager.ts` — `MeltQuoteSubscriptionManager` (DI'd `getWallet`).
- `packages/wallet-sdk/src/internal/lib/cashu/mint-quote-subscription-manager.ts` — `MintQuoteSubscriptionManager`.
- `packages/wallet-sdk/src/internal/lib/cashu/proof-state-subscription-manager.ts` — `ProofStateSubscriptionManager`.
- `packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.ts` — `CashuSendOrchestrator` (`applyMeltQuoteState` incl. #788 + `reconcile`).
- `packages/wallet-sdk/src/internal/orchestrator/cashu-send-swap-orchestrator.ts` — `CashuSendSwapOrchestrator` (`processDrafts` + `applyProofSpent` + `reconcile`).
- `packages/wallet-sdk/src/internal/orchestrator/cashu-receive-quote-orchestrator.ts` — `CashuReceiveQuoteOrchestrator` (`applyMintQuoteState` + `applyCrossMintMeltState` + `reconcile`).
- `packages/wallet-sdk/src/internal/orchestrator/cashu-receive-swap-orchestrator.ts` — `CashuReceiveSwapOrchestrator` (`processPending`).
- `packages/wallet-sdk/src/internal/orchestrator/receive-cashu-token-quote-service.ts` — `ReceiveCashuTokenQuoteService.createCrossAccountReceiveQuotes`.
- `packages/wallet-sdk/src/internal/orchestrator/claim-cashu-token-service.ts` — `ClaimCashuTokenService.claimToken`.
- One `*.test.ts` beside each of the above.

**Modified:**
- `packages/wallet-sdk/src/internal/lib/cashu/index.ts` — re-export the 3 managers.
- `packages/wallet-sdk/src/types/cashu.ts` — add the public `CashuReceiveSwap` type.
- `packages/wallet-sdk/src/internal/repositories/cashu-receive-swap-repository.ts` — import `CashuReceiveSwap` from `types/cashu` (+ compile-time `_SchemaFitsContract` check), drop the local `export type`.
- `packages/wallet-sdk/src/domains.ts` — widen `CashuReceiveOps.receiveToken` return to `Promise<CashuReceiveQuote | SparkReceiveQuote | CashuReceiveSwap>`.
- `packages/wallet-sdk/src/index.ts` — export `CashuReceiveSwap`.

**Untouched in 07a (S9 wires):** `cashu-domain.ts` (`executeQuote`/`receiveToken` keep throwing `NotImplementedError`), `sdk.ts`. All quote *expiry* driving (no WS event fires on expiry) is left to S9's poll loop, which already enumerates unresolved quotes — the orchestrators here cover only the WS-event-driven transitions.

---

### Task 1: `isSubset` + `MeltQuoteSubscriptionManager`

**Files:**
- Create: `packages/wallet-sdk/src/internal/lib/sets.ts`
- Create: `packages/wallet-sdk/src/internal/lib/sets.test.ts`
- Create: `packages/wallet-sdk/src/internal/lib/cashu/melt-quote-subscription-manager.ts`
- Create: `packages/wallet-sdk/src/internal/lib/cashu/melt-quote-subscription-manager.test.ts`

- [ ] **Step 1: Write `isSubset` test**

`packages/wallet-sdk/src/internal/lib/sets.test.ts`:
```ts
import { describe, expect, it } from 'bun:test';
import { isSubset } from './sets';

describe('isSubset', () => {
  it('true when every element is in the superset', () => {
    expect(isSubset(new Set([1, 2]), new Set([1, 2, 3]))).toBe(true);
  });
  it('true for the empty set', () => {
    expect(isSubset(new Set<number>(), new Set([1]))).toBe(true);
  });
  it('false when an element is missing', () => {
    expect(isSubset(new Set([1, 4]), new Set([1, 2, 3]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun test packages/wallet-sdk/src/internal/lib/sets.test.ts` → "Cannot find module './sets'".

- [ ] **Step 3: Implement `isSubset`**

`packages/wallet-sdk/src/internal/lib/sets.ts`:
```ts
/**
 * True when every element of `subset` is in `superset`. Uses the native
 * `Set.prototype.isSubsetOf` when the runtime provides it, else a manual scan.
 */
export function isSubset<T>(subset: Set<T>, superset: Set<T>): boolean {
  const native = (subset as { isSubsetOf?: (other: Set<T>) => boolean })
    .isSubsetOf;
  if (typeof native === 'function') {
    return native.call(subset, superset);
  }
  for (const item of subset) {
    if (!superset.has(item)) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run it; expect PASS** — `bun test packages/wallet-sdk/src/internal/lib/sets.test.ts`.

- [ ] **Step 5: Write the melt-manager test**

The manager opens one cashu-ts WS per mint via an injected `getWallet`, dedupes added quote-ids via `isSubset`, and relays each `MeltQuoteBolt11Response` to the latest `onUpdate`. The fake wallet captures the WS callback so we can fire synthetic updates.

`packages/wallet-sdk/src/internal/lib/cashu/melt-quote-subscription-manager.test.ts`:
```ts
import { describe, expect, it, mock } from 'bun:test';
import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import type { ExtendedCashuWallet } from './utils';
import { MeltQuoteSubscriptionManager } from './melt-quote-subscription-manager';

type Captured = {
  ids: string[];
  cb: (q: MeltQuoteBolt11Response) => void;
};

function fakeWallet() {
  const captured: Captured[] = [];
  const unsubscribe = mock(() => {});
  const wallet = {
    on: {
      meltQuoteUpdates: mock(
        async (
          ids: string[],
          cb: (q: MeltQuoteBolt11Response) => void,
          _onErr: (e: unknown) => void,
        ) => {
          captured.push({ ids, cb });
          return unsubscribe;
        },
      ),
    },
    mint: { webSocketConnection: { onClose: mock(() => {}) } },
  } as unknown as ExtendedCashuWallet;
  return { wallet, captured, unsubscribe };
}

describe('MeltQuoteSubscriptionManager', () => {
  it('opens one WS for the mint and relays updates to onUpdate', async () => {
    const { wallet, captured } = fakeWallet();
    const getWallet = mock(async (_mintUrl: string) => wallet);
    const manager = new MeltQuoteSubscriptionManager(getWallet);

    const updates: string[] = [];
    await manager.subscribe({
      mintUrl: 'https://mint.test',
      quoteIds: ['q1', 'q2'],
      onUpdate: (q) => updates.push(q.quote),
    });

    expect(getWallet).toHaveBeenCalledWith('https://mint.test');
    expect(captured[0]?.ids).toEqual(['q1', 'q2']);

    captured[0]?.cb({ quote: 'q1', state: 'PAID' } as MeltQuoteBolt11Response);
    expect(updates).toEqual(['q1']);
  });

  it('reuses the WS and swaps the callback when the new ids are a subset', async () => {
    const { wallet, captured } = fakeWallet();
    const getWallet = mock(async () => wallet);
    const manager = new MeltQuoteSubscriptionManager(getWallet);

    await manager.subscribe({
      mintUrl: 'm',
      quoteIds: ['q1', 'q2'],
      onUpdate: () => {},
    });
    const seen: string[] = [];
    await manager.subscribe({
      mintUrl: 'm',
      quoteIds: ['q1'],
      onUpdate: (q) => seen.push(q.quote),
    });

    expect(wallet.on.meltQuoteUpdates).toHaveBeenCalledTimes(1); // no re-open
    captured[0]?.cb({ quote: 'q1', state: 'PAID' } as MeltQuoteBolt11Response);
    expect(seen).toEqual(['q1']); // latest callback used
  });

  it('removeQuoteFromSubscription drops one id without unsubscribing', async () => {
    const { wallet, unsubscribe } = fakeWallet();
    const manager = new MeltQuoteSubscriptionManager(async () => wallet);
    await manager.subscribe({
      mintUrl: 'm',
      quoteIds: ['q1', 'q2'],
      onUpdate: () => {},
    });
    manager.removeQuoteFromSubscription({ mintUrl: 'm', quoteId: 'q1' });
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it; expect FAIL** — module not found.

- [ ] **Step 7: Port the manager (DI'd `getWallet`, SDK `isSubset`)**

`packages/wallet-sdk/src/internal/lib/cashu/melt-quote-subscription-manager.ts`:
```ts
import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import { isSubset } from '../sets';
import type { ExtendedCashuWallet } from './utils';

type SubscriptionData = {
  ids: Set<string>;
  subscriptionPromise: Promise<() => void>;
  onUpdate: (meltQuoteResponse: MeltQuoteBolt11Response) => void;
};

/**
 * Tracks one cashu-ts melt-quote websocket per mint URL, covering all currently
 * subscribed quote ids for that mint. Reconnect/backoff is the caller's concern
 * (the manager only self-cleans on socket close / subscribe failure).
 */
export class MeltQuoteSubscriptionManager {
  private subscriptions = new Map<string, SubscriptionData>();

  constructor(
    private readonly getWallet: (
      mintUrl: string,
    ) => Promise<ExtendedCashuWallet>,
  ) {}

  async subscribe({
    mintUrl,
    quoteIds,
    onUpdate,
  }: {
    mintUrl: string;
    quoteIds: string[];
    onUpdate: (meltQuoteResponse: MeltQuoteBolt11Response) => void;
  }): Promise<() => void> {
    const ids = new Set(quoteIds);
    const mintSubscription = this.subscriptions.get(mintUrl);

    if (mintSubscription) {
      const unsubscribe = await mintSubscription.subscriptionPromise;
      if (isSubset(ids, mintSubscription.ids)) {
        this.subscriptions.set(mintUrl, { ...mintSubscription, onUpdate });
        return () => {
          unsubscribe();
          this.subscriptions.delete(mintUrl);
        };
      }
      unsubscribe();
    }

    const wallet = await this.getWallet(mintUrl);

    const subscriptionCallback = (meltQuote: MeltQuoteBolt11Response) => {
      this.subscriptions.get(mintUrl)?.onUpdate(meltQuote);
    };

    const subscriptionPromise = wallet.on.meltQuoteUpdates(
      Array.from(ids),
      subscriptionCallback,
      (error) =>
        console.error('Melt quote updates socket error', { mintUrl, cause: error }),
    );

    this.subscriptions.set(mintUrl, { ids, subscriptionPromise, onUpdate });

    try {
      const unsubscribe = await subscriptionPromise;
      wallet.mint.webSocketConnection?.onClose(() => {
        this.subscriptions.delete(mintUrl);
      });
      return () => {
        unsubscribe();
        this.subscriptions.delete(mintUrl);
      };
    } catch (error) {
      this.subscriptions.delete(mintUrl);
      throw error;
    }
  }

  /** Drop one quote id from a mint's tracked set without tearing down the socket. */
  removeQuoteFromSubscription({
    mintUrl,
    quoteId,
  }: {
    mintUrl: string;
    quoteId: string;
  }): void {
    const mintSubscription = this.subscriptions.get(mintUrl);
    if (!mintSubscription || !mintSubscription.ids.has(quoteId)) return;
    const ids = new Set(mintSubscription.ids);
    ids.delete(quoteId);
    this.subscriptions.set(mintUrl, { ...mintSubscription, ids });
  }
}
```

- [ ] **Step 8: Run it; expect PASS** — `bun test packages/wallet-sdk/src/internal/lib/cashu/melt-quote-subscription-manager.test.ts`.

- [ ] **Step 9: Commit**
```bash
git add packages/wallet-sdk/src/internal/lib/sets.ts packages/wallet-sdk/src/internal/lib/sets.test.ts packages/wallet-sdk/src/internal/lib/cashu/melt-quote-subscription-manager.ts packages/wallet-sdk/src/internal/lib/cashu/melt-quote-subscription-manager.test.ts
git commit -m "feat(wallet-sdk): port melt-quote subscription manager (DI'd wallet) + isSubset"
```

---

### Task 2: `MintQuoteSubscriptionManager`

**Files:**
- Create: `packages/wallet-sdk/src/internal/lib/cashu/mint-quote-subscription-manager.ts`
- Create: `packages/wallet-sdk/src/internal/lib/cashu/mint-quote-subscription-manager.test.ts`

- [ ] **Step 1: Write the test** (same shape as Task 1, `mintQuoteUpdates` + `MintQuoteBolt11Response`):

`mint-quote-subscription-manager.test.ts`:
```ts
import { describe, expect, it, mock } from 'bun:test';
import type { MintQuoteBolt11Response } from '@cashu/cashu-ts';
import type { ExtendedCashuWallet } from './utils';
import { MintQuoteSubscriptionManager } from './mint-quote-subscription-manager';

function fakeWallet() {
  const captured: { ids: string[]; cb: (q: MintQuoteBolt11Response) => void }[] = [];
  const wallet = {
    on: {
      mintQuoteUpdates: mock(
        async (
          ids: string[],
          cb: (q: MintQuoteBolt11Response) => void,
          _onErr: (e: unknown) => void,
        ) => {
          captured.push({ ids, cb });
          return mock(() => {});
        },
      ),
    },
    mint: { webSocketConnection: { onClose: mock(() => {}) } },
  } as unknown as ExtendedCashuWallet;
  return { wallet, captured };
}

describe('MintQuoteSubscriptionManager', () => {
  it('opens one WS per mint and relays mint-quote updates', async () => {
    const { wallet, captured } = fakeWallet();
    const manager = new MintQuoteSubscriptionManager(async () => wallet);
    const seen: string[] = [];
    await manager.subscribe({
      mintUrl: 'm',
      quoteIds: ['q1'],
      onUpdate: (q) => seen.push(q.quote),
    });
    captured[0]?.cb({ quote: 'q1', state: 'PAID' } as MintQuoteBolt11Response);
    expect(seen).toEqual(['q1']);
  });

  it('reuses the socket when the new ids are a subset', async () => {
    const { wallet } = fakeWallet();
    const manager = new MintQuoteSubscriptionManager(async () => wallet);
    await manager.subscribe({ mintUrl: 'm', quoteIds: ['q1', 'q2'], onUpdate: () => {} });
    await manager.subscribe({ mintUrl: 'm', quoteIds: ['q1'], onUpdate: () => {} });
    expect(wallet.on.mintQuoteUpdates).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run; expect FAIL** (module not found).

- [ ] **Step 3: Implement** — identical structure to the melt manager, swapping the type to `MintQuoteBolt11Response` and the WS method to `wallet.on.mintQuoteUpdates`, and **omit** `removeQuoteFromSubscription` (the web's mint manager doesn't have it):

`mint-quote-subscription-manager.ts`:
```ts
import type { MintQuoteBolt11Response } from '@cashu/cashu-ts';
import { isSubset } from '../sets';
import type { ExtendedCashuWallet } from './utils';

type SubscriptionData = {
  ids: Set<string>;
  subscriptionPromise: Promise<() => void>;
  onUpdate: (mintQuoteResponse: MintQuoteBolt11Response) => void;
};

/** One cashu-ts mint-quote websocket per mint URL, covering all subscribed quote ids. */
export class MintQuoteSubscriptionManager {
  private subscriptions = new Map<string, SubscriptionData>();

  constructor(
    private readonly getWallet: (
      mintUrl: string,
    ) => Promise<ExtendedCashuWallet>,
  ) {}

  async subscribe({
    mintUrl,
    quoteIds,
    onUpdate,
  }: {
    mintUrl: string;
    quoteIds: string[];
    onUpdate: (mintQuoteResponse: MintQuoteBolt11Response) => void;
  }): Promise<() => void> {
    const ids = new Set(quoteIds);
    const mintSubscription = this.subscriptions.get(mintUrl);

    if (mintSubscription) {
      const unsubscribe = await mintSubscription.subscriptionPromise;
      if (isSubset(ids, mintSubscription.ids)) {
        this.subscriptions.set(mintUrl, { ...mintSubscription, onUpdate });
        return () => {
          unsubscribe();
          this.subscriptions.delete(mintUrl);
        };
      }
      unsubscribe();
    }

    const wallet = await this.getWallet(mintUrl);

    const subscriptionCallback = (mintQuote: MintQuoteBolt11Response) => {
      this.subscriptions.get(mintUrl)?.onUpdate(mintQuote);
    };

    const subscriptionPromise = wallet.on.mintQuoteUpdates(
      Array.from(ids),
      subscriptionCallback,
      (error) =>
        console.error('Mint quote updates socket error', { mintUrl, cause: error }),
    );

    this.subscriptions.set(mintUrl, { ids, subscriptionPromise, onUpdate });

    try {
      const unsubscribe = await subscriptionPromise;
      wallet.mint.webSocketConnection?.onClose(() => {
        this.subscriptions.delete(mintUrl);
      });
      return () => {
        unsubscribe();
        this.subscriptions.delete(mintUrl);
      };
    } catch (error) {
      this.subscriptions.delete(mintUrl);
      throw error;
    }
  }
}
```

- [ ] **Step 4: Run; expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add packages/wallet-sdk/src/internal/lib/cashu/mint-quote-subscription-manager.ts packages/wallet-sdk/src/internal/lib/cashu/mint-quote-subscription-manager.test.ts
git commit -m "feat(wallet-sdk): port mint-quote subscription manager (DI'd wallet)"
```

---

### Task 3: `ProofStateSubscriptionManager`

**Files:**
- Create: `packages/wallet-sdk/src/internal/lib/cashu/proof-state-subscription-manager.ts`
- Create: `packages/wallet-sdk/src/internal/lib/cashu/proof-state-subscription-manager.test.ts`

This manager subscribes to **proofs** (not quote ids) and fires `onSpent(swap)` only once **every** proof of a swap reads `SPENT`. It carries a per-swap accumulator. It imports `PendingCashuSendSwap`/`CashuSendSwap` from `types/cashu` and `toProof` from the cashu lib.

- [ ] **Step 1: Write the test**

`proof-state-subscription-manager.test.ts`:
```ts
import { describe, expect, it, mock } from 'bun:test';
import type { Proof, ProofState } from '@cashu/cashu-ts';
import type { PendingCashuSendSwap } from '../../../types/cashu';
import type { ExtendedCashuWallet } from './utils';
import { ProofStateSubscriptionManager } from './proof-state-subscription-manager';

function fakeWallet() {
  let cb: ((u: ProofState & { proof: Proof }) => void) | undefined;
  const wallet = {
    on: {
      proofStateUpdates: mock(
        async (
          _proofs: Proof[],
          onUpdate: (u: ProofState & { proof: Proof }) => void,
          _onErr: (e: unknown) => void,
        ) => {
          cb = onUpdate;
          return mock(() => {});
        },
      ),
    },
    mint: { webSocketConnection: { onClose: mock(() => {}) } },
  } as unknown as ExtendedCashuWallet;
  return { wallet, fire: (u: ProofState & { proof: Proof }) => cb?.(u) };
}

const swap = {
  id: 'swap-1',
  state: 'PENDING',
  proofsToSend: [
    { unblindedSignature: 'C1' },
    { unblindedSignature: 'C2' },
  ],
} as unknown as PendingCashuSendSwap;

describe('ProofStateSubscriptionManager', () => {
  it('fires onSpent only after every proof of the swap is SPENT', async () => {
    const { wallet, fire } = fakeWallet();
    const manager = new ProofStateSubscriptionManager(async () => wallet);
    const spent: string[] = [];
    await manager.subscribe({
      mintUrl: 'm',
      swaps: [swap],
      onSpent: (s) => spent.push(s.id),
    });

    fire({ state: 'SPENT', proof: { C: 'C1' } } as ProofState & { proof: Proof });
    expect(spent).toEqual([]); // one of two proofs spent
    fire({ state: 'SPENT', proof: { C: 'C2' } } as ProofState & { proof: Proof });
    expect(spent).toEqual(['swap-1']); // all spent
  });
});
```

- [ ] **Step 2: Run; expect FAIL.**

- [ ] **Step 3: Implement** (port from `apps/web-wallet/app/features/send/proof-state-subscription-manager.ts`, DI'd `getWallet`, SDK imports):

`proof-state-subscription-manager.ts`:
```ts
import type { Proof, ProofState } from '@cashu/cashu-ts';
import type { CashuSendSwap, PendingCashuSendSwap } from '../../../types/cashu';
import { isSubset } from '../sets';
import { toProof } from './proof';
import type { ExtendedCashuWallet } from './utils';

type Subscription = {
  ids: Set<string>;
  subscriptionPromise: Promise<() => void>;
  onSpent: (swap: CashuSendSwap) => void;
};

/** Subscribes to proof-state updates per mint; fires `onSpent` once a swap's proofs are all SPENT. */
export class ProofStateSubscriptionManager {
  private subscriptions = new Map<string, Subscription>();
  private proofUpdates: Record<string, Record<string, ProofState['state']>> = {};

  constructor(
    private readonly getWallet: (
      mintUrl: string,
    ) => Promise<ExtendedCashuWallet>,
  ) {}

  async subscribe({
    mintUrl,
    swaps,
    onSpent,
  }: {
    mintUrl: string;
    swaps: PendingCashuSendSwap[];
    onSpent: (swap: CashuSendSwap) => void;
  }): Promise<() => void> {
    const ids = swaps.map((x) => x.id);
    const idsSet = new Set(ids);
    const mintSubscription = this.subscriptions.get(mintUrl);

    if (mintSubscription) {
      const unsubscribe = await mintSubscription.subscriptionPromise;
      if (isSubset(idsSet, mintSubscription.ids)) {
        this.subscriptions.set(mintUrl, { ...mintSubscription, onSpent });
        return () => {
          unsubscribe();
          this.subscriptions.delete(mintUrl);
        };
      }
      unsubscribe();
    }

    const wallet = await this.getWallet(mintUrl);

    const subscriptionCallback = (proofUpdate: ProofState & { proof: Proof }) => {
      const current = this.subscriptions.get(mintUrl);
      if (current) {
        this.handleProofStateUpdate(proofUpdate, swaps, current.onSpent);
      }
    };

    const subscriptionPromise = wallet.on.proofStateUpdates(
      swaps.flatMap((x) => x.proofsToSend).map((p) => toProof(p)),
      subscriptionCallback,
      (error) =>
        console.error('Proof state updates socket error', { mintUrl, cause: error }),
    );

    this.subscriptions.set(mintUrl, { ids: idsSet, subscriptionPromise, onSpent });

    try {
      const unsubscribe = await subscriptionPromise;
      wallet.mint.webSocketConnection?.onClose(() => {
        this.subscriptions.delete(mintUrl);
      });
      return () => {
        unsubscribe();
        this.subscriptions.delete(mintUrl);
      };
    } catch (error) {
      this.subscriptions.delete(mintUrl);
      throw error;
    }
  }

  private handleProofStateUpdate(
    proofUpdate: ProofState & { proof: Proof },
    swaps: PendingCashuSendSwap[],
    onSpent: (swap: CashuSendSwap) => void,
  ): void {
    const swap = swaps.find((s) =>
      s.proofsToSend.some((p) => p.unblindedSignature === proofUpdate.proof.C),
    );
    if (!swap) return;

    this.proofUpdates[swap.id] ??= {};
    this.proofUpdates[swap.id][proofUpdate.proof.C] = proofUpdate.state;

    const allProofsSpent = swap.proofsToSend.every(
      (proof) => this.proofUpdates[swap.id][proof.unblindedSignature] === 'SPENT',
    );

    if (allProofsSpent) {
      delete this.proofUpdates[swap.id];
      onSpent(swap);
    }
  }
}
```
> Verify `toProof` is exported from `./proof` (the barrel re-exports `./proof`); if it lives elsewhere, import it from `../cashu` to match the existing services. Confirm `PendingCashuSendSwap` is exported from `types/cashu` (it is — `CashuSendSwap & { state: 'PENDING' }`).

- [ ] **Step 4: Run; expect PASS.**

- [ ] **Step 5: Re-export the 3 managers from the cashu barrel**

Edit `packages/wallet-sdk/src/internal/lib/cashu/index.ts`, appending:
```ts
export { MeltQuoteSubscriptionManager } from './melt-quote-subscription-manager';
export { MintQuoteSubscriptionManager } from './mint-quote-subscription-manager';
export { ProofStateSubscriptionManager } from './proof-state-subscription-manager';
```

- [ ] **Step 6: Typecheck + commit**
```bash
bun run typecheck
git add packages/wallet-sdk/src/internal/lib/cashu/proof-state-subscription-manager.ts packages/wallet-sdk/src/internal/lib/cashu/proof-state-subscription-manager.test.ts packages/wallet-sdk/src/internal/lib/cashu/index.ts
git commit -m "feat(wallet-sdk): port proof-state subscription manager + barrel exports"
```

---

### Task 4: Publish `CashuReceiveSwap` + widen `receiveToken` return

**Files:**
- Modify: `packages/wallet-sdk/src/types/cashu.ts`
- Modify: `packages/wallet-sdk/src/internal/repositories/cashu-receive-swap-repository.ts`
- Modify: `packages/wallet-sdk/src/domains.ts`
- Modify: `packages/wallet-sdk/src/index.ts`

The same-mint claim produces a `CashuReceiveSwap`, which the contract's `receiveToken` return must now include (owner decision: widen + publish). The repository's zod schema stays the source of the parsed shape; we move only the *type* to the public `types/cashu.ts` and add a compile-time conformance check in the repo (mirroring the spark repos' `_SchemaFitsContract` pattern).

- [ ] **Step 1: Read the current type** — open `packages/wallet-sdk/src/internal/repositories/cashu-receive-swap-repository.ts` and copy the exact field set of `CashuReceiveSwapSchema` (base + the `PENDING | COMPLETED | FAILED` union). Confirmed shape: base `{ tokenHash; tokenProofs: Proof[]; tokenDescription?; userId; accountId; inputAmount: Money; amountReceived: Money; feeAmount: Money; keysetId; keysetCounter; outputAmounts: number[]; transactionId; createdAt; version }` × `{ state: 'PENDING' } | { state: 'COMPLETED' } | { state: 'FAILED'; failureReason: string }`.

- [ ] **Step 2: Add the public type** to `packages/wallet-sdk/src/types/cashu.ts` (place near `CashuSendSwap`):
```ts
/**
 * A same-mint cashu token claim (receive-swap). Returned by `receiveToken` when
 * the token is claimed to its own mint (no Lightning round-trip). `tokenProofs`
 * are the token's input proofs; `outputAmounts` the deterministic outputs.
 */
type CashuReceiveSwapBase = {
  tokenHash: string;
  tokenProofs: CashuProtocolProof[];
  tokenDescription?: string;
  userId: string;
  accountId: string;
  inputAmount: Money;
  amountReceived: Money;
  feeAmount: Money;
  keysetId: string;
  keysetCounter: number;
  outputAmounts: number[];
  transactionId: string;
  createdAt: string;
  version: number;
};

export type CashuReceiveSwap = CashuReceiveSwapBase &
  (
    | { state: 'PENDING' | 'COMPLETED' }
    | { state: 'FAILED'; failureReason: string }
  );
```
> Use the same proof element type the existing `CashuReceiveSwapSchema` infers. The schema uses `ProofSchema` → cashu-ts `Proof`; if `types/cashu.ts` models proofs as `CashuProtocolProof` (it does for `CashuTokenMeltData.tokenProofs`), reuse that import; otherwise import `Proof` from `@cashu/cashu-ts`. Match whichever makes Step 4's conformance check compile.

- [ ] **Step 3: Repoint the repository type + add the conformance check** in `cashu-receive-swap-repository.ts`. Replace `export type CashuReceiveSwap = z.infer<typeof CashuReceiveSwapSchema>;` with an import from `types/cashu` and a compile-time check (matching the spark repo idiom):
```ts
import type { CashuReceiveSwap } from '../../types/cashu';
// ...after CashuReceiveSwapSchema is defined:
type _SchemaFitsContract = z.infer<typeof CashuReceiveSwapSchema> extends CashuReceiveSwap
  ? CashuReceiveSwap extends z.infer<typeof CashuReceiveSwapSchema>
    ? true
    : never
  : never;
const _schemaFitsContract: _SchemaFitsContract = true;
void _schemaFitsContract;
```
Keep re-exporting the type so existing importers (`cashu-receive-swap-service.ts`) still resolve: add `export type { CashuReceiveSwap };` if they import it from the repo, OR update those imports to `from '../../types/cashu'`. Grep `grep -rn "CashuReceiveSwap" packages/wallet-sdk/src` first and fix every import site.

- [ ] **Step 4: Widen the contract return** in `packages/wallet-sdk/src/domains.ts`. Add `CashuReceiveSwap` to the import from `./types/cashu`, and change `CashuReceiveOps.receiveToken`:
```ts
  receiveToken(params: {
    token: string;
    destinationAccount?: Account;
  }): Promise<CashuReceiveQuote | SparkReceiveQuote | CashuReceiveSwap>;
```
Update its JSDoc to note same-mint returns a `CashuReceiveSwap`.

- [ ] **Step 5: Export from the public barrel** — in `packages/wallet-sdk/src/index.ts`, add `CashuReceiveSwap` to the `types/cashu` re-export (find the existing `CashuSendSwap` export line and add it alongside).

- [ ] **Step 6: Typecheck** — `bun run typecheck`. Expected: PASS (the `cashu-domain.ts` `receiveToken` stub returns `never`, assignable to the wider union; the existing `cashu-domain.test.ts` `toThrow(NotImplementedError)` still holds).

- [ ] **Step 7: Run the affected suites** — `bun test packages/wallet-sdk/src/internal/repositories/cashu-receive-swap-repository.test.ts packages/wallet-sdk/src/domains/cashu/` → all green.

- [ ] **Step 8: Commit**
```bash
git add packages/wallet-sdk/src/types/cashu.ts packages/wallet-sdk/src/internal/repositories/cashu-receive-swap-repository.ts packages/wallet-sdk/src/domains.ts packages/wallet-sdk/src/index.ts
git commit -m "feat(wallet-sdk): publish CashuReceiveSwap + widen receiveToken return (same-mint swap)"
```

---

### Task 5: `CashuSendOrchestrator.applyMeltQuoteState` (transitions, no #788 yet)

**Files:**
- Create: `packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.ts`
- Create: `packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.test.ts`

The handler maps a live melt-quote state to a service transition + the matching SDK event. Driven by the WS manager (Task 7) or, in S9, the poll loop. This task does UNPAID/PENDING/PAID without the #788 refetch (Task 6 adds it).

- [ ] **Step 1: Write the transition test** (DI'd fake service + real emitter):

`cashu-send-orchestrator.test.ts`:
```ts
import { describe, expect, it, mock } from 'bun:test';
import { type MeltQuoteBolt11Response, MeltQuoteState } from '@cashu/cashu-ts';
import { Money } from '@agicash/money';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../event-emitter';
import type { CashuAccount } from '../../types/account';
import type { CashuSendQuote } from '../../types/cashu';
import type { CashuSendQuoteService } from '../../domains/cashu/cashu-send-quote-service';
import { CashuSendOrchestrator } from './cashu-send-orchestrator';

const account = {
  id: 'acc-1',
  mintUrl: 'https://mint.test',
  currency: 'BTC',
  wallet: {} as unknown,
} as unknown as CashuAccount;

function unpaidQuote(over: Partial<CashuSendQuote> = {}): CashuSendQuote {
  return {
    id: 'sq-1',
    quoteId: 'mq-1',
    accountId: 'acc-1',
    state: 'UNPAID',
    transactionId: 'tx-1',
    proofs: [],
    amountRequested: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
    ...over,
  } as unknown as CashuSendQuote;
}

function makeDeps(over: Partial<CashuSendQuote> = {}) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const sendQuoteService = {
    initiateSend: mock(async () => ({})),
    markSendQuoteAsPending: mock(async (q: CashuSendQuote) => ({ ...q, state: 'PENDING' })),
    completeSendQuote: mock(async (_a, q: CashuSendQuote) => ({
      ...q,
      state: 'PAID',
      amountRequested: q.amountRequested,
    })),
    failSendQuote: mock(async (_a, q: CashuSendQuote) => ({ ...q, state: 'FAILED' })),
  } as unknown as CashuSendQuoteService;
  const orchestrator = new CashuSendOrchestrator({
    sendQuoteService,
    sendQuoteRepository: {} as never,
    getAccount: mock(async () => account),
    meltSubscriptionManager: {} as never,
    emitter,
  });
  return { orchestrator, sendQuoteService, emitter, quote: unpaidQuote(over) };
}

describe('CashuSendOrchestrator.applyMeltQuoteState', () => {
  it('UNPAID + quote UNPAID → initiateSend', async () => {
    const { orchestrator, sendQuoteService, quote } = makeDeps();
    await orchestrator.applyMeltQuoteState(account, quote, {
      quote: 'mq-1',
      state: MeltQuoteState.UNPAID,
      amount: 100,
    } as MeltQuoteBolt11Response);
    expect(sendQuoteService.initiateSend).toHaveBeenCalledTimes(1);
  });

  it('UNPAID + quote already PENDING → no initiate', async () => {
    const { orchestrator, sendQuoteService, quote } = makeDeps({ state: 'PENDING' });
    await orchestrator.applyMeltQuoteState(account, quote, {
      quote: 'mq-1',
      state: MeltQuoteState.UNPAID,
      amount: 100,
    } as MeltQuoteBolt11Response);
    expect(sendQuoteService.initiateSend).not.toHaveBeenCalled();
  });

  it('PENDING → markSendQuoteAsPending + emits send:pending', async () => {
    const { orchestrator, sendQuoteService, emitter, quote } = makeDeps();
    const events: { quoteId: string }[] = [];
    emitter.on('send:pending', (e) => events.push(e));
    await orchestrator.applyMeltQuoteState(account, quote, {
      quote: 'mq-1',
      state: MeltQuoteState.PENDING,
      amount: 100,
    } as MeltQuoteBolt11Response);
    expect(sendQuoteService.markSendQuoteAsPending).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ quoteId: 'sq-1', transactionId: 'tx-1', protocol: 'cashu' }]);
  });

  it('PAID (change present) → completeSendQuote + emits send:completed', async () => {
    const { orchestrator, sendQuoteService, emitter, quote } = makeDeps({ state: 'PENDING' });
    const events: unknown[] = [];
    emitter.on('send:completed', (e) => events.push(e));
    await orchestrator.applyMeltQuoteState(account, quote, {
      quote: 'mq-1',
      state: MeltQuoteState.PAID,
      amount: 100,
      change: [],
    } as unknown as MeltQuoteBolt11Response);
    expect(sendQuoteService.completeSendQuote).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it('UNPAID initiate throws MintOperationError → failSendQuote + emits send:failed', async () => {
    const { orchestrator, sendQuoteService, emitter, quote } = makeDeps();
    const { MintOperationError } = await import('@cashu/cashu-ts');
    (sendQuoteService.initiateSend as ReturnType<typeof mock>).mockRejectedValueOnce(
      new MintOperationError(11000, 'token already spent'),
    );
    const failed: unknown[] = [];
    emitter.on('send:failed', (e) => failed.push(e));
    await orchestrator.applyMeltQuoteState(account, quote, {
      quote: 'mq-1',
      state: MeltQuoteState.UNPAID,
      amount: 100,
    } as MeltQuoteBolt11Response);
    expect(sendQuoteService.failSendQuote).toHaveBeenCalledTimes(1);
    expect(failed).toHaveLength(1);
  });
});
```
> Confirm `MintOperationError`'s constructor signature in `node_modules/@cashu/cashu-ts` before writing the test (it is `(code: number, detail: string)` in 3.6.1). If the arity differs, adjust the test's `new MintOperationError(...)`.

- [ ] **Step 2: Run; expect FAIL** (module not found).

- [ ] **Step 3: Implement (without #788)** — the PAID branch calls `completeSendQuote(account, sendQuote, meltQuote)` directly for now:

`cashu-send-orchestrator.ts`:
```ts
import {
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  MintOperationError,
} from '@cashu/cashu-ts';
import { SdkError } from '../../errors';
import type { SdkEventMap } from '../../events';
import type { CashuAccount } from '../../types/account';
import type { CashuSendQuote } from '../../types/cashu';
import type { CashuSendQuoteService } from '../../domains/cashu/cashu-send-quote-service';
import type { CashuSendQuoteRepository } from '../repositories/cashu-send-quote-repository';
import type { SdkEventEmitter } from '../event-emitter';
import type { MeltQuoteSubscriptionManager } from '../lib/cashu/melt-quote-subscription-manager';

export type CashuSendOrchestratorDeps = {
  sendQuoteService: CashuSendQuoteService;
  sendQuoteRepository: CashuSendQuoteRepository;
  getAccount: (accountId: string) => Promise<CashuAccount | null>;
  meltSubscriptionManager: MeltQuoteSubscriptionManager;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/**
 * Drives a cashu lightning send through UNPAID → PENDING → PAID off the mint's
 * melt-quote websocket. The kickoff (`initiateSend`) is triggered when the mint
 * reports the melt quote UNPAID; PAID completion derives change proofs (see the
 * nutshell-#788 guard in `resolvePaidMeltQuote`). Lifecycle (subscription start/
 * stop, leader election) is owned by the background loop (S9).
 */
export class CashuSendOrchestrator {
  constructor(private readonly deps: CashuSendOrchestratorDeps) {}

  async applyMeltQuoteState(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: MeltQuoteBolt11Response,
  ): Promise<void> {
    const { sendQuoteService, emitter } = this.deps;

    if (meltQuote.state === MeltQuoteState.UNPAID) {
      if (sendQuote.state !== 'UNPAID') return;
      try {
        await sendQuoteService.initiateSend(account, sendQuote, meltQuote);
      } catch (error) {
        if (error instanceof MintOperationError) {
          const failed = await sendQuoteService.failSendQuote(
            account,
            sendQuote,
            error.message,
          );
          emitter.emit('send:failed', {
            quoteId: failed.id,
            error: new SdkError(error.message, 'cashu_send_failed'),
            protocol: 'cashu',
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (meltQuote.state === MeltQuoteState.PENDING) {
      const updated = await sendQuoteService.markSendQuoteAsPending(sendQuote);
      if (updated.state === 'PENDING') {
        emitter.emit('send:pending', {
          quoteId: updated.id,
          transactionId: updated.transactionId,
          protocol: 'cashu',
        });
      }
      return;
    }

    if (meltQuote.state === MeltQuoteState.PAID) {
      const resolved = await this.resolvePaidMeltQuote(
        account,
        sendQuote,
        meltQuote,
      );
      const completed = await sendQuoteService.completeSendQuote(
        account,
        sendQuote,
        resolved,
      );
      if (completed.state === 'PAID') {
        emitter.emit('send:completed', {
          quoteId: completed.id,
          transactionId: completed.transactionId,
          amount: completed.amountRequested,
          protocol: 'cashu',
        });
      }
    }
  }

  // #788 refetch lands here in Task 6.
  protected async resolvePaidMeltQuote(
    _account: CashuAccount,
    _sendQuote: CashuSendQuote,
    meltQuote: MeltQuoteBolt11Response,
  ): Promise<MeltQuoteBolt11Response> {
    return meltQuote;
  }
}
```

- [ ] **Step 4: Run; expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.ts packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.test.ts
git commit -m "feat(wallet-sdk): cashu send orchestrator melt-state transitions"
```

---

### Task 6: nutshell-#788 change-refetch (MANDATED REGRESSION — §8/§10)

**Files:**
- Modify: `packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.ts`
- Modify: `packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.test.ts`

On melt PAID, if change is expected (`sumProofs(quote.proofs) > meltQuote.amount`) but the WS payload omits `change`, refetch via `account.wallet.checkMeltQuoteBolt11(quoteId)` so `completeSendQuote` can derive the change proofs. Without it, the user's change ecash (real sats) is lost. Ref: https://github.com/cashubtc/nutshell/pull/788.

- [ ] **Step 1: Add the regression tests** (append to `cashu-send-orchestrator.test.ts`). Extend `account.wallet` with a `checkMeltQuoteBolt11` mock that returns the change:
```ts
describe('CashuSendOrchestrator nutshell-#788 change refetch', () => {
  function paidDeps(inputSats: number, meltAmount: number, change: unknown[] | undefined) {
    const emitter = new SdkEventEmitter<SdkEventMap>();
    const checkMeltQuoteBolt11 = mock(async () => ({
      quote: 'mq-1',
      state: MeltQuoteState.PAID,
      amount: meltAmount,
      change: [{ id: 'x' }],
    }));
    const acct = {
      ...account,
      wallet: { checkMeltQuoteBolt11 },
    } as unknown as CashuAccount;
    const sendQuoteService = {
      completeSendQuote: mock(async (_a, q: CashuSendQuote) => ({ ...q, state: 'PAID' })),
    } as unknown as CashuSendQuoteService;
    const orchestrator = new CashuSendOrchestrator({
      sendQuoteService,
      sendQuoteRepository: {} as never,
      getAccount: mock(async () => acct),
      meltSubscriptionManager: {} as never,
      emitter,
    });
    const quote = unpaidQuote({
      state: 'PENDING',
      proofs: Array.from({ length: inputSats }, () => ({ amount: 1 })) as never,
    });
    const meltQuote = {
      quote: 'mq-1',
      state: MeltQuoteState.PAID,
      amount: meltAmount,
      change,
    } as unknown as MeltQuoteBolt11Response;
    return { orchestrator, sendQuoteService, checkMeltQuoteBolt11, acct, quote, meltQuote };
  }

  it('change expected but absent → refetches and completes with the refetched quote', async () => {
    const { orchestrator, sendQuoteService, checkMeltQuoteBolt11, acct, quote, meltQuote } =
      paidDeps(110, 100, undefined);
    await orchestrator.applyMeltQuoteState(acct, quote, meltQuote);
    expect(checkMeltQuoteBolt11).toHaveBeenCalledWith('mq-1');
    const passedMeltQuote = (sendQuoteService.completeSendQuote as ReturnType<typeof mock>).mock
      .calls[0][2] as MeltQuoteBolt11Response;
    expect(passedMeltQuote.change).toHaveLength(1); // refetched change reached completeSendQuote
  });

  it('change already present → no refetch', async () => {
    const { orchestrator, checkMeltQuoteBolt11, acct, quote, meltQuote } = paidDeps(110, 100, [
      { id: 'present' },
    ]);
    await orchestrator.applyMeltQuoteState(acct, quote, meltQuote);
    expect(checkMeltQuoteBolt11).not.toHaveBeenCalled();
  });

  it('no change expected (inputAmount <= amount) → no refetch', async () => {
    const { orchestrator, checkMeltQuoteBolt11, acct, quote, meltQuote } = paidDeps(100, 100, undefined);
    await orchestrator.applyMeltQuoteState(acct, quote, meltQuote);
    expect(checkMeltQuoteBolt11).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — the "refetches" test fails (`checkMeltQuoteBolt11` not called) because `resolvePaidMeltQuote` is still a passthrough.

- [ ] **Step 3: Implement the refetch** — replace `resolvePaidMeltQuote` in `cashu-send-orchestrator.ts`, importing `sumProofs` from the cashu lib:
```ts
import { sumProofs } from '../lib/cashu';
```
```ts
  /**
   * nutshell #788: the melt PAID websocket payload sometimes omits `change`.
   * When change is expected (input proofs exceed the melt amount) but absent,
   * refetch the melt quote so `completeSendQuote` can derive the change proofs;
   * otherwise the user's change ecash is silently lost.
   * https://github.com/cashubtc/nutshell/pull/788
   */
  protected async resolvePaidMeltQuote(
    account: CashuAccount,
    sendQuote: CashuSendQuote,
    meltQuote: MeltQuoteBolt11Response,
  ): Promise<MeltQuoteBolt11Response> {
    const inputAmount = sumProofs(sendQuote.proofs);
    const expectChange = inputAmount > meltQuote.amount;
    if (expectChange && !(meltQuote.change && meltQuote.change.length > 0)) {
      return account.wallet.checkMeltQuoteBolt11(sendQuote.quoteId);
    }
    return meltQuote;
  }
```
> Verify `sumProofs(sendQuote.proofs)` matches how `completeSendQuote` already sums (`sumProofs(sendQuote.proofs)` per the service) — same call, same proof type. Do not convert via `toProof` here (the service doesn't).

- [ ] **Step 4: Run; expect PASS** (all three #788 tests + the Task-5 tests).

- [ ] **Step 5: Commit**
```bash
git add packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.ts packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.test.ts
git commit -m "feat(wallet-sdk): nutshell-#788 change refetch in cashu send orchestrator (regression test)"
```

---

### Task 7: `CashuSendOrchestrator.reconcile` (subscribe pending melts)

**Files:**
- Modify: `packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.ts`
- Modify: `packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.test.ts`

One reconciliation pass: group the given unresolved quotes by mint, subscribe the melt manager (one socket per mint), and route each WS update back through `applyMeltQuoteState`. The S9 loop calls this each tick with a fresh `getUnresolved` list (the manager dedupes via `isSubset`).

- [ ] **Step 1: Add the reconcile test:**
```ts
describe('CashuSendOrchestrator.reconcile', () => {
  it('subscribes the melt manager once per mint with the mint quote ids', async () => {
    const subscribe = mock(async () => () => {});
    const emitter = new SdkEventEmitter<SdkEventMap>();
    const orchestrator = new CashuSendOrchestrator({
      sendQuoteService: {} as never,
      sendQuoteRepository: {} as never,
      getAccount: mock(async () => account),
      meltSubscriptionManager: { subscribe } as never,
      emitter,
    });
    await orchestrator.reconcile([
      unpaidQuote({ id: 'sq-1', quoteId: 'mq-1' }),
      unpaidQuote({ id: 'sq-2', quoteId: 'mq-2' }),
    ]);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect((subscribe.mock.calls[0][0] as { quoteIds: string[] }).quoteIds).toEqual(['mq-1', 'mq-2']);
  });

  it('routes a WS update back into applyMeltQuoteState', async () => {
    let onUpdate: ((q: MeltQuoteBolt11Response) => void) | undefined;
    const subscribe = mock(async (p: { onUpdate: (q: MeltQuoteBolt11Response) => void }) => {
      onUpdate = p.onUpdate;
      return () => {};
    });
    const markSendQuoteAsPending = mock(async (q: CashuSendQuote) => ({ ...q, state: 'PENDING' }));
    const orchestrator = new CashuSendOrchestrator({
      sendQuoteService: { markSendQuoteAsPending } as never,
      sendQuoteRepository: {} as never,
      getAccount: mock(async () => account),
      meltSubscriptionManager: { subscribe } as never,
      emitter: new SdkEventEmitter<SdkEventMap>(),
    });
    await orchestrator.reconcile([unpaidQuote({ id: 'sq-1', quoteId: 'mq-1', state: 'UNPAID' })]);
    onUpdate?.({ quote: 'mq-1', state: MeltQuoteState.PENDING, amount: 100 } as MeltQuoteBolt11Response);
    await new Promise((r) => setTimeout(r, 0)); // let the async handler settle
    expect(markSendQuoteAsPending).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run; expect FAIL** (`reconcile` undefined).

- [ ] **Step 3: Implement `reconcile`** (append the method to the class):
```ts
  /**
   * One reconciliation pass over the given unresolved send quotes: subscribe the
   * mint's melt-quote websocket (one per mint), routing each update through
   * `applyMeltQuoteState`. Idempotent per tick (the manager dedupes via isSubset).
   */
  async reconcile(quotes: CashuSendQuote[]): Promise<void> {
    if (quotes.length === 0) return;

    const byQuoteId = new Map<string, CashuSendQuote>();
    const idsByMint = new Map<string, string[]>();

    for (const quote of quotes) {
      const account = await this.deps.getAccount(quote.accountId);
      if (!account) continue;
      byQuoteId.set(quote.quoteId, quote);
      const list = idsByMint.get(account.mintUrl) ?? [];
      list.push(quote.quoteId);
      idsByMint.set(account.mintUrl, list);
    }

    for (const [mintUrl, quoteIds] of idsByMint) {
      await this.deps.meltSubscriptionManager.subscribe({
        mintUrl,
        quoteIds,
        onUpdate: (meltQuote) => {
          void this.onMeltUpdate(byQuoteId, meltQuote).catch((error) =>
            console.error('cashu send melt update failed', { cause: error }),
          );
        },
      });
    }
  }

  private async onMeltUpdate(
    byQuoteId: Map<string, CashuSendQuote>,
    meltQuote: MeltQuoteBolt11Response,
  ): Promise<void> {
    const sendQuote = byQuoteId.get(meltQuote.quote);
    if (!sendQuote) return;
    const account = await this.deps.getAccount(sendQuote.accountId);
    if (!account) return;
    await this.applyMeltQuoteState(account, sendQuote, meltQuote);
  }
```

- [ ] **Step 4: Run; expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.ts packages/wallet-sdk/src/internal/orchestrator/cashu-send-orchestrator.test.ts
git commit -m "feat(wallet-sdk): cashu send orchestrator reconcile (per-mint melt subscription)"
```

---

### Task 8: `CashuSendSwapOrchestrator` (DRAFT re-drive + proof-spent → complete)

**Files:**
- Create: `packages/wallet-sdk/src/internal/orchestrator/cashu-send-swap-orchestrator.ts`
- Create: `packages/wallet-sdk/src/internal/orchestrator/cashu-send-swap-orchestrator.test.ts`

Two responsibilities (from `useProcessCashuSendSwapTasks`): DRAFT swaps are pushed to PENDING via `swapForProofsToSend`; PENDING swaps complete when the recipient redeems (all proofs SPENT) via the proof-state manager → `complete`.

- [ ] **Step 1: Write the test:**
```ts
import { describe, expect, it, mock } from 'bun:test';
import type { Proof, ProofState } from '@cashu/cashu-ts';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../event-emitter';
import type { CashuAccount } from '../../types/account';
import type { CashuSendSwap, PendingCashuSendSwap } from '../../types/cashu';
import type { CashuSendSwapService } from '../../domains/cashu/cashu-send-swap-service';
import { CashuSendSwapOrchestrator } from './cashu-send-swap-orchestrator';

const account = { id: 'acc-1', mintUrl: 'm', currency: 'BTC', wallet: {} } as unknown as CashuAccount;
const draft = { id: 'sw-1', accountId: 'acc-1', state: 'DRAFT' } as unknown as CashuSendSwap;
const pending = {
  id: 'sw-2',
  accountId: 'acc-1',
  state: 'PENDING',
  proofsToSend: [{ unblindedSignature: 'C1' }],
} as unknown as PendingCashuSendSwap;

function makeDeps() {
  const swapForProofsToSend = mock(async () => {});
  const complete = mock(async () => {});
  const orchestrator = new CashuSendSwapOrchestrator({
    sendSwapService: { swapForProofsToSend, complete } as unknown as CashuSendSwapService,
    getAccount: mock(async () => account),
    proofStateSubscriptionManager: { subscribe: mock(async () => () => {}) } as never,
    emitter: new SdkEventEmitter<SdkEventMap>(),
  });
  return { orchestrator, swapForProofsToSend, complete };
}

describe('CashuSendSwapOrchestrator', () => {
  it('processDrafts → swapForProofsToSend per DRAFT swap', async () => {
    const { orchestrator, swapForProofsToSend } = makeDeps();
    await orchestrator.processDrafts([draft]);
    expect(swapForProofsToSend).toHaveBeenCalledWith({ account, swap: draft });
  });

  it('applyProofSpent → complete', async () => {
    const { orchestrator, complete } = makeDeps();
    await orchestrator.applyProofSpent(pending);
    expect(complete).toHaveBeenCalledWith(pending);
  });

  it('reconcile subscribes the proof-state manager for pending swaps', async () => {
    const subscribe = mock(async () => () => {});
    const orchestrator = new CashuSendSwapOrchestrator({
      sendSwapService: { complete: mock(async () => {}) } as never,
      getAccount: mock(async () => account),
      proofStateSubscriptionManager: { subscribe } as never,
      emitter: new SdkEventEmitter<SdkEventMap>(),
    });
    await orchestrator.reconcile([pending]);
    expect((subscribe.mock.calls[0][0] as { mintUrl: string }).mintUrl).toBe('m');
  });
});
```

- [ ] **Step 2: Run; expect FAIL.**

- [ ] **Step 3: Implement:**
```ts
import type { SdkEventMap } from '../../events';
import type { CashuAccount } from '../../types/account';
import type { CashuSendSwap, PendingCashuSendSwap } from '../../types/cashu';
import type { CashuSendSwapService } from '../../domains/cashu/cashu-send-swap-service';
import type { SdkEventEmitter } from '../event-emitter';
import type { ProofStateSubscriptionManager } from '../lib/cashu/proof-state-subscription-manager';

export type CashuSendSwapOrchestratorDeps = {
  sendSwapService: CashuSendSwapService;
  getAccount: (accountId: string) => Promise<CashuAccount | null>;
  proofStateSubscriptionManager: ProofStateSubscriptionManager;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/** Drives cashu token sends: DRAFT → PENDING (swap), then PENDING → COMPLETED when proofs are spent. */
export class CashuSendSwapOrchestrator {
  constructor(private readonly deps: CashuSendSwapOrchestratorDeps) {}

  /** Push each DRAFT swap to PENDING by swapping out the proofs to send. */
  async processDrafts(swaps: CashuSendSwap[]): Promise<void> {
    for (const swap of swaps) {
      if (swap.state !== 'DRAFT') continue;
      const account = await this.deps.getAccount(swap.accountId);
      if (!account) continue;
      await this.deps.sendSwapService.swapForProofsToSend({ account, swap });
    }
  }

  /** All proofs of a pending swap were spent (recipient redeemed) → mark COMPLETED. */
  async applyProofSpent(swap: CashuSendSwap): Promise<void> {
    await this.deps.sendSwapService.complete(swap);
  }

  /** Subscribe the proof-state websocket for the given pending swaps (one per mint). */
  async reconcile(pending: PendingCashuSendSwap[]): Promise<void> {
    if (pending.length === 0) return;
    const byMint = new Map<string, PendingCashuSendSwap[]>();
    for (const swap of pending) {
      const account = await this.deps.getAccount(swap.accountId);
      if (!account) continue;
      const list = byMint.get(account.mintUrl) ?? [];
      list.push(swap);
      byMint.set(account.mintUrl, list);
    }
    for (const [mintUrl, swaps] of byMint) {
      await this.deps.proofStateSubscriptionManager.subscribe({
        mintUrl,
        swaps,
        onSpent: (swap) => {
          void this.applyProofSpent(swap).catch((error) =>
            console.error('cashu send swap complete failed', { cause: error }),
          );
        },
      });
    }
  }
}
```
> Note: `swap.state` narrows to `'PENDING'` for the proof-state manager (which requires `PendingCashuSendSwap[]`). `reconcile` takes `PendingCashuSendSwap[]`; the S9 loop filters `getUnresolved` accordingly.

- [ ] **Step 4: Run; expect PASS. Step 5: Commit**
```bash
git add packages/wallet-sdk/src/internal/orchestrator/cashu-send-swap-orchestrator.ts packages/wallet-sdk/src/internal/orchestrator/cashu-send-swap-orchestrator.test.ts
git commit -m "feat(wallet-sdk): cashu send-swap orchestrator (draft re-drive + proof-spent completion)"
```

---

### Task 9: `CashuReceiveQuoteOrchestrator.applyMintQuoteState` + `reconcile`

**Files:**
- Create: `packages/wallet-sdk/src/internal/orchestrator/cashu-receive-quote-orchestrator.ts`
- Create: `packages/wallet-sdk/src/internal/orchestrator/cashu-receive-quote-orchestrator.test.ts`

Lightning receive completion: the mint-quote WS reports PAID (or ISSUED for recovery) → `completeReceive` (mints proofs) → emit `receive:completed`.

- [ ] **Step 1: Write the test:**
```ts
import { describe, expect, it, mock } from 'bun:test';
import { type MintQuoteBolt11Response, MintQuoteState } from '@cashu/cashu-ts';
import { Money } from '@agicash/money';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../event-emitter';
import type { CashuAccount } from '../../types/account';
import type { CashuReceiveQuote } from '../../types/cashu';
import type { CashuReceiveQuoteService } from '../../domains/cashu/cashu-receive-quote-service';
import { CashuReceiveQuoteOrchestrator } from './cashu-receive-quote-orchestrator';

const account = { id: 'acc-1', mintUrl: 'm', currency: 'BTC', wallet: {} } as unknown as CashuAccount;
const quote = {
  id: 'rq-1',
  quoteId: 'mintq-1',
  accountId: 'acc-1',
  type: 'LIGHTNING',
  state: 'UNPAID',
  transactionId: 'tx-1',
  amount: new Money({ amount: 50, currency: 'BTC', unit: 'sat' }),
} as unknown as CashuReceiveQuote;

function makeDeps() {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const completeReceive = mock(async () => ({
    quote: { ...quote, state: 'COMPLETED' },
    account,
    addedProofs: ['p1'],
  }));
  const receiveQuoteService = { completeReceive } as unknown as CashuReceiveQuoteService;
  const orchestrator = new CashuReceiveQuoteOrchestrator({
    receiveQuoteService,
    getAccount: mock(async () => account),
    mintSubscriptionManager: { subscribe: mock(async () => () => {}) } as never,
    meltSubscriptionManager: {} as never,
    emitter,
  });
  return { orchestrator, completeReceive, emitter };
}

describe('CashuReceiveQuoteOrchestrator.applyMintQuoteState', () => {
  it('PAID → completeReceive + emits receive:completed', async () => {
    const { orchestrator, completeReceive, emitter } = makeDeps();
    const events: unknown[] = [];
    emitter.on('receive:completed', (e) => events.push(e));
    await orchestrator.applyMintQuoteState(account, quote, {
      quote: 'mintq-1',
      state: MintQuoteState.PAID,
    } as MintQuoteBolt11Response);
    expect(completeReceive).toHaveBeenCalledWith(account, quote);
    expect(events).toHaveLength(1);
  });

  it('ISSUED → completeReceive (idempotent recovery)', async () => {
    const { orchestrator, completeReceive } = makeDeps();
    await orchestrator.applyMintQuoteState(account, quote, {
      quote: 'mintq-1',
      state: MintQuoteState.ISSUED,
    } as MintQuoteBolt11Response);
    expect(completeReceive).toHaveBeenCalledTimes(1);
  });

  it('UNPAID → no-op', async () => {
    const { orchestrator, completeReceive } = makeDeps();
    await orchestrator.applyMintQuoteState(account, quote, {
      quote: 'mintq-1',
      state: MintQuoteState.UNPAID,
    } as MintQuoteBolt11Response);
    expect(completeReceive).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run; expect FAIL.**

- [ ] **Step 3: Implement `applyMintQuoteState` + `reconcile`** (the cross-mint melt handler is added in Task 10; this task leaves a `meltSubscriptionManager` dep + a TODO for it):
```ts
import {
  type MeltQuoteBolt11Response,
  type MintQuoteBolt11Response,
  MintQuoteState,
} from '@cashu/cashu-ts';
import type { SdkEventMap } from '../../events';
import type { CashuAccount } from '../../types/account';
import type { CashuReceiveQuote } from '../../types/cashu';
import type { CashuReceiveQuoteService } from '../../domains/cashu/cashu-receive-quote-service';
import type { SdkEventEmitter } from '../event-emitter';
import type { MeltQuoteSubscriptionManager } from '../lib/cashu/melt-quote-subscription-manager';
import type { MintQuoteSubscriptionManager } from '../lib/cashu/mint-quote-subscription-manager';

export type CashuReceiveQuoteOrchestratorDeps = {
  receiveQuoteService: CashuReceiveQuoteService;
  getAccount: (accountId: string) => Promise<CashuAccount | null>;
  mintSubscriptionManager: MintQuoteSubscriptionManager;
  meltSubscriptionManager: MeltQuoteSubscriptionManager;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/**
 * Drives cashu lightning receives (mint-quote WS → completeReceive) and the
 * cross-mint CASHU_TOKEN melt sub-flow (melt-quote WS → initiateMelt/markMeltInitiated).
 * Quote expiry is loop-driven (S9), not handled here.
 */
export class CashuReceiveQuoteOrchestrator {
  constructor(private readonly deps: CashuReceiveQuoteOrchestratorDeps) {}

  async applyMintQuoteState(
    account: CashuAccount,
    quote: CashuReceiveQuote,
    mintQuote: MintQuoteBolt11Response,
  ): Promise<void> {
    if (
      mintQuote.state !== MintQuoteState.PAID &&
      mintQuote.state !== MintQuoteState.ISSUED
    ) {
      return;
    }
    const result = await this.deps.receiveQuoteService.completeReceive(account, quote);
    if (result.quote.state === 'COMPLETED') {
      this.deps.emitter.emit('receive:completed', {
        quoteId: result.quote.id,
        transactionId: result.quote.transactionId,
        amount: result.quote.amount,
        protocol: 'cashu',
      });
    }
  }

  /** Subscribe the mint-quote websocket for the given pending LIGHTNING/CASHU_TOKEN receive quotes. */
  async reconcileMintQuotes(quotes: CashuReceiveQuote[]): Promise<void> {
    if (quotes.length === 0) return;
    const byQuoteId = new Map<string, CashuReceiveQuote>();
    const idsByMint = new Map<string, string[]>();
    for (const quote of quotes) {
      const account = await this.deps.getAccount(quote.accountId);
      if (!account) continue;
      byQuoteId.set(quote.quoteId, quote);
      const list = idsByMint.get(account.mintUrl) ?? [];
      list.push(quote.quoteId);
      idsByMint.set(account.mintUrl, list);
    }
    for (const [mintUrl, quoteIds] of idsByMint) {
      await this.deps.mintSubscriptionManager.subscribe({
        mintUrl,
        quoteIds,
        onUpdate: (mintQuote) => {
          void this.onMintUpdate(byQuoteId, mintQuote).catch((error) =>
            console.error('cashu receive mint update failed', { cause: error }),
          );
        },
      });
    }
  }

  private async onMintUpdate(
    byQuoteId: Map<string, CashuReceiveQuote>,
    mintQuote: MintQuoteBolt11Response,
  ): Promise<void> {
    const quote = byQuoteId.get(mintQuote.quote);
    if (!quote) return;
    const account = await this.deps.getAccount(quote.accountId);
    if (!account) return;
    await this.applyMintQuoteState(account, quote, mintQuote);
  }

  // applyCrossMintMeltState + reconcileCrossMintMelts land in Task 10.
}
```

- [ ] **Step 4: Run; expect PASS. Step 5: Commit**
```bash
git add packages/wallet-sdk/src/internal/orchestrator/cashu-receive-quote-orchestrator.ts packages/wallet-sdk/src/internal/orchestrator/cashu-receive-quote-orchestrator.test.ts
git commit -m "feat(wallet-sdk): cashu receive-quote orchestrator mint-quote completion"
```

---

### Task 10: Cross-mint CASHU_TOKEN melt handler (receive side)

**Files:**
- Modify: `packages/wallet-sdk/src/internal/orchestrator/cashu-receive-quote-orchestrator.ts`
- Modify: `packages/wallet-sdk/src/internal/orchestrator/cashu-receive-quote-orchestrator.test.ts`

When a cross-account token claim's DESTINATION is a cashu account, the SOURCE-mint melt is monitored via the melt-quote WS: UNPAID + not yet initiated → re-melt (`initiateMelt`); UNPAID + already initiated → the melt failed → `fail` + emit `receive:failed`; PENDING → `markMeltInitiated`. (Completion of the destination receive happens via the mint-quote path, Task 9.) Mirrors `useProcessCashuReceiveQuoteTasks`'s melt subscription.

- [ ] **Step 1: Add the test** (a CASHU_TOKEN quote whose `tokenReceiveData` carries the source melt):
```ts
import { MeltQuoteState } from '@cashu/cashu-ts';

const tokenQuote = {
  id: 'rq-2',
  accountId: 'acc-1',
  type: 'CASHU_TOKEN',
  state: 'UNPAID',
  transactionId: 'tx-2',
  amount: new Money({ amount: 40, currency: 'BTC', unit: 'sat' }),
  tokenReceiveData: {
    sourceMintUrl: 'https://source.mint',
    meltQuoteId: 'src-melt-1',
    meltInitiated: false,
    tokenProofs: [{ amount: 1 }],
    tokenAmount: new Money({ amount: 50, currency: 'BTC', unit: 'sat' }),
    cashuReceiveFee: new Money({ amount: 1, currency: 'BTC', unit: 'sat' }),
    lightningFeeReserve: new Money({ amount: 1, currency: 'BTC', unit: 'sat' }),
  },
} as unknown as CashuReceiveQuote;

describe('CashuReceiveQuoteOrchestrator.applyCrossMintMeltState', () => {
  function makeMeltDeps(over: Partial<{ meltInitiated: boolean }> = {}) {
    const emitter = new SdkEventEmitter<SdkEventMap>();
    const initiateMelt = mock(async () => {});
    const markMeltInitiated = mock(async () => tokenQuote);
    const fail = mock(async () => {});
    const orchestrator = new CashuReceiveQuoteOrchestrator({
      receiveQuoteService: { markMeltInitiated, fail } as never,
      getAccount: mock(async () => account),
      mintSubscriptionManager: {} as never,
      meltSubscriptionManager: { subscribe: mock(async () => () => {}) } as never,
      emitter,
    });
    const q = {
      ...tokenQuote,
      tokenReceiveData: { ...tokenQuote.tokenReceiveData, meltInitiated: over.meltInitiated ?? false },
    } as CashuReceiveQuote;
    return { orchestrator, q, initiateMelt, markMeltInitiated, fail, emitter };
  }

  it('UNPAID + not initiated → initiateMelt callback fired', async () => {
    const { orchestrator, q, initiateMelt } = makeMeltDeps({ meltInitiated: false });
    await orchestrator.applyCrossMintMeltState(q, { quote: 'src-melt-1', state: MeltQuoteState.UNPAID, amount: 40 } as never, { initiateMelt });
    expect(initiateMelt).toHaveBeenCalledWith(q);
  });

  it('PENDING → markMeltInitiated', async () => {
    const { orchestrator, q, markMeltInitiated } = makeMeltDeps();
    await orchestrator.applyCrossMintMeltState(q, { quote: 'src-melt-1', state: MeltQuoteState.PENDING, amount: 40 } as never, { initiateMelt: mock(async () => {}) });
    expect(markMeltInitiated).toHaveBeenCalledTimes(1);
  });

  it('UNPAID + already initiated → fail + emits receive:failed', async () => {
    const { orchestrator, q, fail, emitter } = makeMeltDeps({ meltInitiated: true });
    const failed: unknown[] = [];
    emitter.on('receive:failed', (e) => failed.push(e));
    await orchestrator.applyCrossMintMeltState(q, { quote: 'src-melt-1', state: MeltQuoteState.UNPAID, amount: 40 } as never, { initiateMelt: mock(async () => {}) });
    expect(fail).toHaveBeenCalledTimes(1);
    expect(failed).toHaveLength(1);
  });
});
```
> `initiateMelt` is injected per-call because the actual melt (`sourceWallet.meltProofsIdempotent`) needs the *source* mint wallet, which the S9 wiring resolves; the orchestrator only decides *when* to melt. (This mirrors the web's `initiateMelt` mutation living outside the subscription.)

- [ ] **Step 2: Run; expect FAIL.**

- [ ] **Step 3: Implement `applyCrossMintMeltState`** (append to the class). It takes the receive quote, the source melt-quote state, and an injected `initiateMelt` callback:
```ts
import { MeltQuoteState } from '@cashu/cashu-ts';
import { SdkError } from '../../errors';
```
```ts
  /**
   * Cross-mint CASHU_TOKEN claim: react to the SOURCE-mint melt quote.
   * - UNPAID + not yet initiated → (re)initiate the melt.
   * - UNPAID + already initiated → the melt failed → fail the receive quote.
   * - PENDING → record that the melt is in flight.
   * Destination receive completion runs via the mint-quote path (applyMintQuoteState).
   */
  async applyCrossMintMeltState(
    quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' },
    meltQuote: MeltQuoteBolt11Response,
    handlers: { initiateMelt: (quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' }) => Promise<void> },
  ): Promise<void> {
    if (meltQuote.state === MeltQuoteState.UNPAID) {
      if (quote.tokenReceiveData.meltInitiated) {
        await this.deps.receiveQuoteService.fail(quote, 'Cashu token melt failed.');
        this.deps.emitter.emit('receive:failed', {
          quoteId: quote.id,
          error: new SdkError('Cashu token melt failed.', 'cashu_token_melt_failed'),
          protocol: 'cashu',
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
```
> The method param `quote` is typed `CashuReceiveQuote & { type: 'CASHU_TOKEN' }`; the test's plain object satisfies it. Add a `reconcileCrossMintMelts(quotes, { initiateMelt })` companion mirroring `reconcileMintQuotes` (group CASHU_TOKEN quotes by `tokenReceiveData.sourceMintUrl`, subscribe the `meltSubscriptionManager` with `quoteIds = [tokenReceiveData.meltQuoteId]`, route updates through `applyCrossMintMeltState`). Write it analogously to `reconcileMintQuotes` and add a one-line subscribe-count test.

- [ ] **Step 4: Run; expect PASS. Step 5: Commit**
```bash
git add packages/wallet-sdk/src/internal/orchestrator/cashu-receive-quote-orchestrator.ts packages/wallet-sdk/src/internal/orchestrator/cashu-receive-quote-orchestrator.test.ts
git commit -m "feat(wallet-sdk): cashu receive cross-mint melt handler (CASHU_TOKEN sub-flow)"
```

---

### Task 11: `CashuReceiveSwapOrchestrator` (same-mint claim completion)

**Files:**
- Create: `packages/wallet-sdk/src/internal/orchestrator/cashu-receive-swap-orchestrator.ts`
- Create: `packages/wallet-sdk/src/internal/orchestrator/cashu-receive-swap-orchestrator.test.ts`

Same-mint claims have no WS; the web re-drives `completeSwap` per pending swap each poll. This orchestrator exposes `processPending(swaps)` that completes each, emitting `receive:completed` on success.

- [ ] **Step 1: Write the test:**
```ts
import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../event-emitter';
import type { CashuAccount } from '../../types/account';
import type { CashuReceiveSwap } from '../../types/cashu';
import type { CashuReceiveSwapService } from '../../domains/cashu/cashu-receive-swap-service';
import { CashuReceiveSwapOrchestrator } from './cashu-receive-swap-orchestrator';

const account = { id: 'acc-1' } as unknown as CashuAccount;
const swap = {
  tokenHash: 'h1',
  accountId: 'acc-1',
  state: 'PENDING',
  transactionId: 'tx-1',
  amountReceived: new Money({ amount: 10, currency: 'BTC', unit: 'sat' }),
} as unknown as CashuReceiveSwap;

describe('CashuReceiveSwapOrchestrator.processPending', () => {
  it('completes each pending swap and emits receive:completed', async () => {
    const emitter = new SdkEventEmitter<SdkEventMap>();
    const completeSwap = mock(async () => ({
      swap: { ...swap, state: 'COMPLETED' },
      account,
      addedProofs: ['p'],
    }));
    const orchestrator = new CashuReceiveSwapOrchestrator({
      receiveSwapService: { completeSwap } as unknown as CashuReceiveSwapService,
      getAccount: mock(async () => account),
      emitter,
    });
    const events: unknown[] = [];
    emitter.on('receive:completed', (e) => events.push(e));
    await orchestrator.processPending([swap]);
    expect(completeSwap).toHaveBeenCalledWith(account, swap);
    expect(events).toHaveLength(1);
  });

  it('skips a swap whose account is missing', async () => {
    const completeSwap = mock(async () => ({ swap, account, addedProofs: [] }));
    const orchestrator = new CashuReceiveSwapOrchestrator({
      receiveSwapService: { completeSwap } as never,
      getAccount: mock(async () => null),
      emitter: new SdkEventEmitter<SdkEventMap>(),
    });
    await orchestrator.processPending([swap]);
    expect(completeSwap).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run; expect FAIL.**

- [ ] **Step 3: Implement:**
```ts
import type { SdkEventMap } from '../../events';
import type { CashuAccount } from '../../types/account';
import type { CashuReceiveSwap } from '../../types/cashu';
import type { CashuReceiveSwapService } from '../../domains/cashu/cashu-receive-swap-service';
import type { SdkEventEmitter } from '../event-emitter';

export type CashuReceiveSwapOrchestratorDeps = {
  receiveSwapService: CashuReceiveSwapService;
  getAccount: (accountId: string) => Promise<CashuAccount | null>;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/** Completes pending same-mint cashu token claims (receive-swaps); poll-driven, no WS. */
export class CashuReceiveSwapOrchestrator {
  constructor(private readonly deps: CashuReceiveSwapOrchestratorDeps) {}

  async processPending(swaps: CashuReceiveSwap[]): Promise<void> {
    for (const swap of swaps) {
      if (swap.state !== 'PENDING') continue;
      const account = await this.deps.getAccount(swap.accountId);
      if (!account) continue;
      const result = await this.deps.receiveSwapService.completeSwap(account, swap);
      if (result.swap.state === 'COMPLETED') {
        this.deps.emitter.emit('receive:completed', {
          quoteId: result.swap.tokenHash,
          transactionId: result.swap.transactionId,
          amount: result.swap.amountReceived,
          protocol: 'cashu',
        });
      }
    }
  }
}
```
> `receive:completed.quoteId` carries the swap's `tokenHash` (its stable id) for same-mint claims — the consumer keys the active receive screen on whatever `receiveToken` returned (Task 13 returns the swap, whose `tokenHash` is its id).

- [ ] **Step 4: Run; expect PASS. Step 5: Commit**
```bash
git add packages/wallet-sdk/src/internal/orchestrator/cashu-receive-swap-orchestrator.ts packages/wallet-sdk/src/internal/orchestrator/cashu-receive-swap-orchestrator.test.ts
git commit -m "feat(wallet-sdk): cashu receive-swap orchestrator (same-mint claim completion)"
```

---

### Task 12: `ReceiveCashuTokenQuoteService.createCrossAccountReceiveQuotes`

**Files:**
- Create: `packages/wallet-sdk/src/internal/orchestrator/receive-cashu-token-quote-service.ts`
- Create: `packages/wallet-sdk/src/internal/orchestrator/receive-cashu-token-quote-service.test.ts`

Port from `apps/web-wallet/app/features/receive/receive-cashu-token-quote-service.ts`. Creates a destination Lightning RECEIVE quote (cashu or spark) + a SOURCE-mint melt quote whose cost fits the token (the 5-attempt shrink loop), then persists the destination quote with `receiveType: 'CASHU_TOKEN'` linking `meltQuoteId`. Returns `cashuMeltQuote` + the persisted destination quote.

- [ ] **Step 1: Write the test** (fake services + a fake source wallet whose `createMeltQuoteBolt11` fits on the first attempt):
```ts
import { describe, expect, it, mock } from 'bun:test';
import type { MeltQuoteBolt11Response, Token } from '@cashu/cashu-ts';
import { Money } from '@agicash/money';
import type { CashuAccount, SparkAccount } from '../../types/account';
import type { CashuReceiveQuoteService } from '../../domains/cashu/cashu-receive-quote-service';
import type { SparkReceiveQuoteService } from '../../domains/spark/spark-receive-quote-service';
import { ReceiveCashuTokenQuoteService } from './receive-cashu-token-quote-service';

const token = {
  mint: 'https://source.mint',
  unit: 'sat',
  proofs: [{ amount: 50, id: 'k', secret: 's', C: 'c' }],
} as unknown as Token;

function makeSourceAccount() {
  return {
    id: 'src',
    type: 'cashu',
    currency: 'BTC',
    mintUrl: 'https://source.mint',
    wallet: {
      getFeesForProofs: mock(() => 1),
      createMeltQuoteBolt11: mock(
        async (): Promise<MeltQuoteBolt11Response> =>
          ({ quote: 'src-melt', amount: 45, fee_reserve: 1, expiry: 9_999_999_999 }) as MeltQuoteBolt11Response,
      ),
    },
  } as unknown as CashuAccount;
}

describe('ReceiveCashuTokenQuoteService.createCrossAccountReceiveQuotes (cashu destination)', () => {
  it('creates the destination cashu receive quote linked to the source melt', async () => {
    const sourceAccount = makeSourceAccount();
    const destinationAccount = {
      id: 'dst',
      type: 'cashu',
      currency: 'BTC',
      mintUrl: 'https://dest.mint',
      wallet: {},
    } as unknown as CashuAccount;

    const cashuReceiveQuoteService = {
      getLightningQuote: mock(async () => ({ mintQuote: { request: 'lnbc-dest' }, amount: new Money({ amount: 45, currency: 'BTC', unit: 'sat' }) })),
      createReceiveQuote: mock(async () => ({ id: 'dest-rq', paymentRequest: 'lnbc-dest', amount: new Money({ amount: 45, currency: 'BTC', unit: 'sat' }), transactionId: 'tx' })),
    } as unknown as CashuReceiveQuoteService;
    const sparkReceiveQuoteService = {} as unknown as SparkReceiveQuoteService;

    const service = new ReceiveCashuTokenQuoteService(cashuReceiveQuoteService, sparkReceiveQuoteService);
    const result = await service.createCrossAccountReceiveQuotes({
      userId: 'u1',
      token,
      sourceAccount,
      destinationAccount,
      exchangeRate: '1',
    });

    expect(result.destinationType).toBe('cashu');
    expect(result.cashuMeltQuote.quote).toBe('src-melt');
    const createArg = (cashuReceiveQuoteService.createReceiveQuote as ReturnType<typeof mock>).mock.calls[0][0] as {
      receiveType: string;
      meltQuoteId: string;
      sourceMintUrl: string;
    };
    expect(createArg.receiveType).toBe('CASHU_TOKEN');
    expect(createArg.meltQuoteId).toBe('src-melt');
    expect(createArg.sourceMintUrl).toBe('https://source.mint');
  });

  it('throws when the token cannot cover the cashu fee', async () => {
    const sourceAccount = makeSourceAccount();
    (sourceAccount.wallet.getFeesForProofs as ReturnType<typeof mock>).mockReturnValue(1000);
    const service = new ReceiveCashuTokenQuoteService(
      { getLightningQuote: mock(), createReceiveQuote: mock() } as never,
      {} as never,
    );
    await expect(
      service.createCrossAccountReceiveQuotes({
        userId: 'u1',
        token,
        sourceAccount,
        destinationAccount: { id: 'dst', type: 'cashu', currency: 'BTC', mintUrl: 'https://dest.mint', wallet: {} } as unknown as CashuAccount,
        exchangeRate: '1',
      }),
    ).rejects.toThrow();
  });
});
```
> Add a spark-destination test too: `destinationAccount.type === 'spark'`, inject a fake `sparkReceiveQuoteService.createReceiveQuote` and a `getLightningQuote` for spark (the SDK's `spark-receive-quote-core` `getLightningQuote({ wallet, amount })` returns `{ invoice: { paymentRequest } }`). Assert `result.destinationType === 'spark'` and the melt link. Import the spark core `getLightningQuote` and spy it, or inject a `getSparkLightningQuote` dep (see Step 3 note).

- [ ] **Step 2: Run; expect FAIL.**

- [ ] **Step 3: Implement** — port the web service, swapping web helpers for SDK equivalents. Key adaptations: the destination Lightning quote for **cashu** uses `cashuReceiveQuoteService.getLightningQuote({ wallet: destinationAccount.wallet, amount })` (paymentRequest = `mintQuote.request`); for **spark** uses the SDK's `spark-receive-quote-core` `getLightningQuote({ wallet: destinationAccount.wallet, amount, description })` (paymentRequest = `invoice.paymentRequest`). `Money.convert(currency, rateString)` and `Money.subtract/zero/isNegative/lessThanOrEqual` are on `@agicash/money`. Use `tokenToMoney` + `getCashuUnit` from `../lib/cashu`.

`receive-cashu-token-quote-service.ts`:
```ts
import type { MeltQuoteBolt11Response, Token } from '@cashu/cashu-ts';
import { Money } from '@agicash/money';
import { DomainError } from '../../errors';
import type { Account, CashuAccount, SparkAccount } from '../../types/account';
import type {
  CashuReceiveQuote,
  SparkReceiveQuote,
} from '../../types/cashu'; // SparkReceiveQuote from '../../types/spark'
import type { CashuReceiveLightningQuote } from '../../domains/cashu/cashu-receive-quote-core';
import type { CashuReceiveQuoteService } from '../../domains/cashu/cashu-receive-quote-service';
import {
  type SparkReceiveLightningQuote,
  getLightningQuote as getSparkLightningQuote,
} from '../../domains/spark/spark-receive-quote-core';
import type { SparkReceiveQuoteService } from '../../domains/spark/spark-receive-quote-service';
import { getCashuUnit, tokenToMoney } from '../lib/cashu';

export type CreateCrossAccountReceiveQuotesProps = {
  userId: string;
  token: Token;
  destinationAccount: Account;
  sourceAccount: CashuAccount;
  exchangeRate: string;
};

type LightningReceiveQuote = {
  id: string;
  paymentRequest: string;
  amount: Money;
  transactionId: string;
  destinationType: 'cashu' | 'spark';
};

export type CrossAccountReceiveQuotesResult = {
  cashuMeltQuote: MeltQuoteBolt11Response;
  lightningReceiveQuote: LightningReceiveQuote;
} & (
  | { destinationType: 'cashu'; destinationAccount: CashuAccount; cashuReceiveQuote: CashuReceiveQuote }
  | { destinationType: 'spark'; destinationAccount: SparkAccount; sparkReceiveQuote: SparkReceiveQuote }
);

export class ReceiveCashuTokenQuoteService {
  constructor(
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly sparkReceiveQuoteService: SparkReceiveQuoteService,
  ) {}

  async createCrossAccountReceiveQuotes({
    userId,
    token,
    sourceAccount,
    destinationAccount,
    exchangeRate,
  }: CreateCrossAccountReceiveQuotesProps): Promise<CrossAccountReceiveQuotesResult> {
    const tokenAmount = tokenToMoney(token);
    const sourceCashuUnit = getCashuUnit(sourceAccount.currency);

    const feesForProofs = sourceAccount.wallet.getFeesForProofs(token.proofs);
    const cashuReceiveFee = new Money({
      amount: feesForProofs,
      currency: tokenAmount.currency,
      unit: sourceCashuUnit,
    });
    const targetAmount = tokenAmount.subtract(cashuReceiveFee);
    if (targetAmount.isNegative()) {
      throw new DomainError('Token amount is too small to cover cashu fees.', 'token_too_small');
    }

    const quotes = await this.getCrossMintQuotesWithinTargetAmount({
      destinationAccount,
      sourceAccount,
      targetAmount,
      exchangeRate,
      description: token.memo,
    });

    const meltQuoteExpiresAt = new Date(quotes.meltQuote.expiry * 1000).toISOString();
    const lightningFeeReserve = new Money({
      amount: quotes.meltQuote.fee_reserve,
      currency: tokenAmount.currency,
      unit: sourceCashuUnit,
    });

    if (destinationAccount.type === 'cashu') {
      const cashuReceiveQuote = await this.cashuReceiveQuoteService.createReceiveQuote({
        userId,
        account: destinationAccount,
        receiveType: 'CASHU_TOKEN',
        lightningQuote: quotes.lightningQuote as CashuReceiveLightningQuote,
        tokenAmount,
        sourceMintUrl: sourceAccount.mintUrl,
        tokenProofs: token.proofs,
        meltQuoteId: quotes.meltQuote.quote,
        meltQuoteExpiresAt,
        cashuReceiveFee,
        lightningFeeReserve,
      });
      return {
        destinationType: 'cashu',
        destinationAccount,
        cashuReceiveQuote,
        cashuMeltQuote: quotes.meltQuote,
        lightningReceiveQuote: {
          id: cashuReceiveQuote.id,
          paymentRequest: cashuReceiveQuote.paymentRequest,
          amount: cashuReceiveQuote.amount,
          transactionId: cashuReceiveQuote.transactionId,
          destinationType: 'cashu',
        },
      };
    }

    const sparkReceiveQuote = await this.sparkReceiveQuoteService.createReceiveQuote({
      userId,
      account: destinationAccount,
      receiveType: 'CASHU_TOKEN',
      lightningQuote: quotes.lightningQuote as SparkReceiveLightningQuote,
      tokenAmount,
      sourceMintUrl: sourceAccount.mintUrl,
      tokenProofs: token.proofs,
      meltQuoteId: quotes.meltQuote.quote,
      meltQuoteExpiresAt,
      cashuReceiveFee,
      lightningFeeReserve,
    });
    return {
      destinationType: 'spark',
      destinationAccount,
      sparkReceiveQuote,
      cashuMeltQuote: quotes.meltQuote,
      lightningReceiveQuote: {
        id: sparkReceiveQuote.id,
        paymentRequest: sparkReceiveQuote.paymentRequest,
        amount: sparkReceiveQuote.amount,
        transactionId: sparkReceiveQuote.transactionId,
        destinationType: 'spark',
      },
    };
  }

  private async getCrossMintQuotesWithinTargetAmount({
    destinationAccount,
    sourceAccount,
    targetAmount,
    exchangeRate,
    description,
  }: {
    destinationAccount: Account;
    sourceAccount: CashuAccount;
    targetAmount: Money;
    exchangeRate: string;
    description?: string;
  }): Promise<{
    lightningQuote: CashuReceiveLightningQuote | SparkReceiveLightningQuote;
    meltQuote: MeltQuoteBolt11Response;
    amountToMint: Money;
  }> {
    const destinationCurrency = destinationAccount.currency;
    let attempts = 0;
    let amountToMelt = targetAmount;

    while (attempts < 5) {
      attempts++;
      const amountToMint = amountToMelt.convert(destinationCurrency, exchangeRate);
      if (amountToMint.toNumber(getCashuUnit(destinationCurrency)) < 1) {
        throw new DomainError('Token amount is too small to cover the fees.', 'token_too_small');
      }

      const { lightningQuote, paymentRequest } = await this.getLightningQuoteForDestinationAccount({
        destinationAccount,
        amount: amountToMint,
        description,
      });

      const meltQuote = await sourceAccount.wallet.createMeltQuoteBolt11(paymentRequest);
      const amountRequired = new Money({
        amount: meltQuote.amount + meltQuote.fee_reserve,
        currency: sourceAccount.currency,
        unit: getCashuUnit(sourceAccount.currency),
      });
      const diff = amountRequired.subtract(targetAmount);
      if (diff.lessThanOrEqual(Money.zero(diff.currency))) {
        return { meltQuote, amountToMint, lightningQuote };
      }
      amountToMelt = amountToMelt.subtract(diff);
    }
    throw new DomainError('Failed to find valid quotes after 5 attempts.', 'quote_unavailable');
  }

  private async getLightningQuoteForDestinationAccount({
    destinationAccount,
    amount,
    description,
  }: {
    destinationAccount: Account;
    amount: Money;
    description?: string;
  }): Promise<{
    lightningQuote: CashuReceiveLightningQuote | SparkReceiveLightningQuote;
    paymentRequest: string;
  }> {
    if (destinationAccount.type === 'spark') {
      const lightningQuote = await getSparkLightningQuote({
        wallet: destinationAccount.wallet,
        amount,
        description,
      });
      return { lightningQuote, paymentRequest: lightningQuote.invoice.paymentRequest };
    }
    const lightningQuote = await this.cashuReceiveQuoteService.getLightningQuote({
      wallet: (destinationAccount as CashuAccount).wallet,
      amount,
      description,
    });
    return { lightningQuote, paymentRequest: lightningQuote.mintQuote.request };
  }
}
```
> Import `SparkReceiveQuote` from `../../types/spark` (not `types/cashu`). Confirm `Money.convert(currency, rateString)` / `lessThanOrEqual` / `isNegative` / `subtract` / `zero` exist on `@agicash/money` (they're used by the web service); read `packages/money/src` if unsure. Confirm `cashuReceiveQuoteService.getLightningQuote` accepts `{ wallet, amount, description }` (it omits `xPub`, deriving it internally — per its signature `Omit<GetLightningQuoteParams,'xPub'>`).

- [ ] **Step 4: Run; expect PASS. Step 5: Commit**
```bash
git add packages/wallet-sdk/src/internal/orchestrator/receive-cashu-token-quote-service.ts packages/wallet-sdk/src/internal/orchestrator/receive-cashu-token-quote-service.test.ts
git commit -m "feat(wallet-sdk): cross-account receive-quote service (token melt-then-mint quoting)"
```

---

### Task 13: `ClaimCashuTokenService.claimToken` (same-mint vs cross-account)

**Files:**
- Create: `packages/wallet-sdk/src/internal/orchestrator/claim-cashu-token-service.ts`
- Create: `packages/wallet-sdk/src/internal/orchestrator/claim-cashu-token-service.test.ts`

The decision + kickoff. Same-mint → `receiveSwapService.create` → return the swap. Cross-account → `createCrossAccountReceiveQuotes` → kick off the SOURCE melt (`sourceAccount.wallet.meltProofsIdempotent(... , { type: 'random' })`, as the web does — change is discarded) → return the destination quote. Completion is background (the orchestrators above). The accounts are passed in already-resolved (S9's `receiveToken` wiring resolves them via the S5 `ReceiveCashuTokenService` + decodes the token string).

- [ ] **Step 1: Write the test:**
```ts
import { describe, expect, it, mock } from 'bun:test';
import type { Token } from '@cashu/cashu-ts';
import { Money } from '@agicash/money';
import type { CashuAccount, SparkAccount } from '../../types/account';
import type { CashuReceiveSwapService } from '../../domains/cashu/cashu-receive-swap-service';
import type { ReceiveCashuTokenQuoteService } from './receive-cashu-token-quote-service';
import { ClaimCashuTokenService } from './claim-cashu-token-service';

const token = { mint: 'https://mint.a', unit: 'sat', proofs: [{ amount: 10 }] } as unknown as Token;

function cashuAccount(id: string, mintUrl: string): CashuAccount {
  return { id, type: 'cashu', currency: 'BTC', mintUrl, wallet: { meltProofsIdempotent: mock(async () => ({})) } } as unknown as CashuAccount;
}

describe('ClaimCashuTokenService.claimToken', () => {
  it('same mint+currency → creates a receive swap and returns it', async () => {
    const source = cashuAccount('src', 'https://mint.a');
    const dest = cashuAccount('src', 'https://mint.a'); // same account
    const swap = { tokenHash: 'h', state: 'PENDING' };
    const receiveSwapService = { create: mock(async () => ({ swap, account: dest })) } as unknown as CashuReceiveSwapService;
    const service = new ClaimCashuTokenService({
      receiveSwapService,
      receiveCashuTokenQuoteService: {} as ReceiveCashuTokenQuoteService,
      getRate: mock(async () => '1'),
    });
    const result = await service.claimToken({ userId: 'u1', token, sourceAccount: source, destinationAccount: dest });
    expect(receiveSwapService.create).toHaveBeenCalledTimes(1);
    expect(result as unknown).toBe(swap);
  });

  it('different mint → creates cross-account quotes, melts the source, returns the destination quote', async () => {
    const source = cashuAccount('src', 'https://mint.a');
    const dest = cashuAccount('dst', 'https://mint.b');
    const cashuReceiveQuote = { id: 'dest-rq' };
    const createCrossAccountReceiveQuotes = mock(async () => ({
      destinationType: 'cashu',
      destinationAccount: dest,
      cashuReceiveQuote,
      cashuMeltQuote: { quote: 'src-melt', amount: 9, fee_reserve: 1 },
      lightningReceiveQuote: { id: 'dest-rq', paymentRequest: 'pr', amount: new Money({ amount: 9, currency: 'BTC', unit: 'sat' }), transactionId: 'tx', destinationType: 'cashu' },
    }));
    const service = new ClaimCashuTokenService({
      receiveSwapService: {} as CashuReceiveSwapService,
      receiveCashuTokenQuoteService: { createCrossAccountReceiveQuotes } as unknown as ReceiveCashuTokenQuoteService,
      getRate: mock(async () => '1'),
    });
    const result = await service.claimToken({ userId: 'u1', token, sourceAccount: source, destinationAccount: dest });
    expect(createCrossAccountReceiveQuotes).toHaveBeenCalledTimes(1);
    expect(source.wallet.meltProofsIdempotent).toHaveBeenCalledTimes(1);
    expect(result as unknown).toBe(cashuReceiveQuote);
  });

  it('cross-account to spark → returns the spark receive quote', async () => {
    const source = cashuAccount('src', 'https://mint.a');
    const dest = { id: 'spark', type: 'spark', currency: 'BTC', wallet: {} } as unknown as SparkAccount;
    const sparkReceiveQuote = { id: 'spark-rq' };
    const createCrossAccountReceiveQuotes = mock(async () => ({
      destinationType: 'spark',
      destinationAccount: dest,
      sparkReceiveQuote,
      cashuMeltQuote: { quote: 'src-melt', amount: 9, fee_reserve: 1 },
      lightningReceiveQuote: { id: 'spark-rq', paymentRequest: 'pr', amount: new Money({ amount: 9, currency: 'BTC', unit: 'sat' }), transactionId: 'tx', destinationType: 'spark' },
    }));
    const service = new ClaimCashuTokenService({
      receiveSwapService: {} as CashuReceiveSwapService,
      receiveCashuTokenQuoteService: { createCrossAccountReceiveQuotes } as unknown as ReceiveCashuTokenQuoteService,
      getRate: mock(async () => '1'),
    });
    const result = await service.claimToken({ userId: 'u1', token, sourceAccount: source, destinationAccount: dest });
    expect(result as unknown).toBe(sparkReceiveQuote);
  });
});
```

- [ ] **Step 2: Run; expect FAIL.**

- [ ] **Step 3: Implement:**
```ts
import type { Token } from '@cashu/cashu-ts';
import type { Account, CashuAccount } from '../../types/account';
import type { CashuReceiveQuote, CashuReceiveSwap } from '../../types/cashu';
import type { SparkReceiveQuote } from '../../types/spark';
import type { CashuReceiveSwapService } from '../../domains/cashu/cashu-receive-swap-service';
import { isClaimingToSameCashuAccount } from '../../domains/cashu/receive-cashu-token-models';
import type { ReceiveCashuTokenQuoteService } from './receive-cashu-token-quote-service';

export type ClaimCashuTokenServiceDeps = {
  receiveSwapService: CashuReceiveSwapService;
  receiveCashuTokenQuoteService: ReceiveCashuTokenQuoteService;
  getRate: (ticker: string) => Promise<string>;
};

/**
 * Claims a cashu token. Same mint+currency → a free receive-swap (returned as a
 * CashuReceiveSwap). Otherwise melt-then-mint into the destination account: create
 * the cross-account quotes, kick off the SOURCE melt, and return the destination
 * receive quote (cashu or spark). Completion is driven by the background orchestrators.
 */
export class ClaimCashuTokenService {
  constructor(private readonly deps: ClaimCashuTokenServiceDeps) {}

  async claimToken({
    userId,
    token,
    sourceAccount,
    destinationAccount,
  }: {
    userId: string;
    token: Token;
    sourceAccount: CashuAccount;
    destinationAccount: Account;
  }): Promise<CashuReceiveQuote | SparkReceiveQuote | CashuReceiveSwap> {
    if (isClaimingToSameCashuAccount(destinationAccount, sourceAccount)) {
      const { swap } = await this.deps.receiveSwapService.create({
        userId,
        token,
        account: destinationAccount as CashuAccount,
      });
      return swap;
    }

    const exchangeRate = await this.deps.getRate(
      `${sourceAccount.currency}-${destinationAccount.currency}`,
    );
    const quotes = await this.deps.receiveCashuTokenQuoteService.createCrossAccountReceiveQuotes({
      userId,
      token,
      sourceAccount,
      destinationAccount,
      exchangeRate,
    });

    // Kick off the source-mint melt. Random change outputs (change is discarded
    // here, see CashuTokenMeltData) avoid counter collisions with the source
    // account's persisted keyset counter. Idempotent: safe if a retry re-melts.
    await sourceAccount.wallet.meltProofsIdempotent(
      quotes.cashuMeltQuote,
      token.proofs,
      undefined,
      { type: 'random' },
    );

    return quotes.destinationType === 'cashu'
      ? quotes.cashuReceiveQuote
      : quotes.sparkReceiveQuote;
  }
}
```
> `isClaimingToSameCashuAccount(a, b)` is already exported from `domains/cashu/receive-cashu-token-models.ts` (returns true only when both are cashu, same currency, and `areMintUrlsEqual`). `getRate` is injected (S9 supplies `sdk.exchangeRate.getRate`); ticker form `'BTC-USD'`. The default same-mint case (no `destinationAccount`) is handled in S9's wiring by passing `destinationAccount = sourceAccount`.

- [ ] **Step 4: Run; expect PASS.**

- [ ] **Step 5: Full gate + commit**
```bash
bun run typecheck && bun run test
git add packages/wallet-sdk/src/internal/orchestrator/claim-cashu-token-service.ts packages/wallet-sdk/src/internal/orchestrator/claim-cashu-token-service.test.ts
git commit -m "feat(wallet-sdk): claim-cashu-token service (same-mint vs cross-account melt-then-mint)"
```

---

## Self-Review

**Spec coverage (07a's share of S7):**
- 3 WS subscription managers ported, framework-free, DI'd wallet, offline-tested → Tasks 1–3. ✅
- nutshell-#788 change-refetch + mandated regression test → Task 6. ✅
- cashu send / send-swap / receive-quote / receive-swap processors (the 4 cashu task processors) → Tasks 5,7 / 8 / 9,10 / 11. ✅ (2 spark processors are 07b.)
- `receiveToken` building blocks: cross-account quote service (Task 12) + claim service incl. same-mint vs cross-account decision (Task 13); the public `receiveToken` is wired in S9. ✅
- `CashuReceiveSwap` published + `receiveToken` return widened (owner decision) → Task 4. ✅
- Deferred to S9 (per owner's "primitives only"): wiring `executeQuote`/`receiveToken`, the leader-elected poll loop, subscription lifecycle (start/stop), quote-expiry driving, token-string decode + account resolution for `receiveToken`. Deferred to 07b: all spark orchestration + the §8 spark `synced` balance regression.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step shows complete code; every test step shows assertions. The few `>`-prefixed notes are *verification reminders* (confirm an existing signature before writing), not deferred work.

**Type consistency:** Service method names/arg shapes match the verified S5 signatures (`initiateSend(account, sendQuote, meltQuote)`, `markSendQuoteAsPending(quote)`, `completeSendQuote(account, sendQuote, meltQuote)`, `completeReceive(account, quote)`, `swapForProofsToSend({account, swap})`, `complete(swap)`, `completeSwap(account, swap)`, `markMeltInitiated(quote)`, `createReceiveQuote(...)`). Event payloads match `SdkEventMap` exactly (`send:pending/completed/failed`, `receive:completed/failed`). `DomainError`/`SdkError` calls use `(message, code)`. Orchestrators in `internal/orchestrator/` import services from `domains/cashu/` (precedent exists; no enforced boundary).

**Risks to watch during execution:**
- `Money` API surface (`convert(currency, rateString)`, `lessThanOrEqual`, `isNegative`, `subtract`, `zero`) — verify against `packages/money` before Task 12 (the verification note is in-step).
- `MintOperationError` constructor arity (Task 5 test) — verify in `node_modules/@cashu/cashu-ts`.
- `toProof` / `sumProofs` import source — mirror the existing services' import lines exactly.
- The dark orchestrator files are unimported by the domain in 07a; confirm `bun run typecheck` doesn't flag them as unused (it won't — they're exported + test-imported).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-07a-cashu-orchestrator.md`. Per the task brief, execute with **superpowers:subagent-driven-development** — a fresh subagent per task, two-stage review between tasks, gate = `bun run typecheck` + `bun run test`. After 07a is committed + green, write **07b (spark orchestrator + §8 balance listener)** grounded in the actual shapes 07a established, then execute it.
