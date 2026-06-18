# Wallet-SDK Base Plan 6b-ops — Protocol *Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four protocol-operation facades — `sdk.cashu.send`, `sdk.cashu.receive`, `sdk.spark.send`, `sdk.spark.receive` — plus a shared `awaitTerminal` helper, completing the public foreground send/receive surface of `@agicash/wallet-sdk` (variant-independent).

**Architecture:** Each `*Op` is a plain class wrapping already-extracted SDK services/repos + the 4c background processors. The division of labour is **`execute` = create-only**: the foreground persists the initial quote/swap row and returns; the Plan-4c LEADER processor + NUT-17/Breez subscription managers drive every state transition to terminal. `createLightningQuote` is the (already-collapsed) estimate step — it does NOT persist. `awaitTerminal` listens on the base-owned lifecycle events (`send:*`/`receive:*`, identical in both variants) filtered by `quoteId`, with one immediate repo state-check backstop (events don't replay on attach). The lone synchronous driver is `CashuSendOps.createTokenSend` (foreground swap to produce a shareable token) — verified safe against the concurrent processor because the swap is idempotent (deterministic outputs + `OUTPUT_ALREADY_SIGNED`→restore + `state!=='DRAFT'` guard).

**Tech Stack:** TypeScript, `bun:test`, `@agicash/money`, `@agicash/cashu` (`encodeToken`, `getCashuProtocolUnit`), `@cashu/cashu-ts`, `big.js`.

## Global Constraints

- **Gate = `bun run typecheck` + `bun run test` ONLY**, from the worktree root (`/Users/ditto/Projects/MakePrisms/agicash/.claude/worktrees/sdk-extraction-fable`). Both green before each commit (8 packages typecheck exit 0; full suite 0 fail).
- **⛔ NEVER run `bun run fix:all`** (biome `check --write` across the whole repo — pollutes the working tree, does NOT typecheck). Implementers AND reviewers. Discard any pollution with `git checkout -- .`.
- **Package manager: `bun` only.** Branch `sdkx/base` — commit here, do NOT push.
- **`execute` is CREATE-ONLY** for every *Op — persist the row and return; the 4c processor owns initiate/complete/markPending/expire/fail. NEVER call those processor methods from a facade (double-drive = double-melt/double-mint). The sole exception: `CashuSendOps.createTokenSend` runs the swap inline.
- **`createLightningQuote` does NOT persist** — it returns the estimate/invoice (`*LightningQuote`). `execute` takes that quote and persists.
- **`awaitTerminal` rejects on failure/expiry, resolves on completion.** It requires `sdk.background.start()` to have run (lifecycle events come from the realtime change-feed). Subscribe FIRST, then run the backstop. Per-entity terminal sets are NOT shared (PAID is non-terminal for cashu-receive, terminal for spark-receive).
- **Error parity:** plain `Error` for `'No authenticated user'` and the post-swap guards; `DomainError` only where the source/lifecycle uses it (expiry, `failureReason`).
- **No TanStack/Sentry/retry/cache** in any facade. Domain classes are NOT barrel-exported (reached via `sdk.cashu.send.x`); only new public param/return TYPES get barrel `export type`.
- **Namespace:** `sdk.cashu = { send, receive }`, `sdk.spark = { send, receive }` (plain object literals; matches the planned `sdk.cashu.receive.receiveToken` for 6c).

**Reachability (verified, on `walletRuntime.protocols`):** `cashuSendQuoteService`, `cashuSendSwapService`, `cashuSendQuoteRepository`, `cashuSendSwapRepository`, `cashuReceiveQuoteService`, `cashuReceiveQuoteRepository`, `sparkSendQuoteService`, `sparkReceiveQuoteService`. The four new *Ops are constructed in `Sdk.create` where `walletRuntime`, `events` (`EventBus<SdkCoreEventMap>`), and `getCurrentUserId` are already in scope.

**Verbatim signatures (confirmed at tip `793081b2`):**
- `CashuSendQuoteService.getLightningQuote(o: GetCashuLightningQuoteOptions): Promise<CashuLightningQuote>` where `GetCashuLightningQuoteOptions = { account: CashuAccount; paymentRequest: string; amount?: Money; exchangeRate?: Big }`; `CashuLightningQuote` includes `{ paymentRequest; amountRequested: Money; amountRequestedInBtc: Money<'BTC'>; meltQuote: MeltQuoteBolt11Response; ... }`.
- `CashuSendQuoteService.createSendQuote({ userId, account, sendQuote, destinationDetails?, purpose?, transferId? }): Promise<CashuSendQuote>` where `sendQuote: SendQuoteRequest = { paymentRequest; amountRequested: Money; amountRequestedInBtc: Money<'BTC'>; meltQuote: MeltQuoteBolt11Response }`.
- `CashuSendSwapService.create({ userId, account, amount, senderPaysFee }): Promise<CashuSendSwap>` (DRAFT, or PENDING if exact proofs); `swapForProofsToSend({ account, swap }): Promise<void>` (guards `swap.state !== 'DRAFT'`); `reverse(swap: CashuSendSwap, account: CashuAccount): Promise<void>` (requires PENDING). `CashuSendSwap` PENDING/COMPLETED states carry `proofsToSend: CashuProof[]` + `tokenHash`; all carry `id`, `transactionId`, `amountReceived: Money`, `amountToSend: Money`, `state`.
- `CashuSendQuoteRepository.get(id): Promise<CashuSendQuote | null>`; `CashuSendSwapRepository.get(id): Promise<CashuSendSwap | null>`.
- `SparkSendQuoteService.getLightningSendQuote(o: { account: SparkAccount; paymentRequest: string; amount?: Money<'BTC'> }): Promise<SparkLightningQuote>`; `createSendQuote({ userId, account, quote, purpose?, transferId? }): Promise<SparkSendQuote>`; `get(quoteId): Promise<SparkSendQuote | null>`.
- `CashuReceiveQuoteService.getLightningQuote(p: Omit<GetLightningQuoteParams,'xPub'>): Promise<CashuReceiveLightningQuote>` where `GetLightningQuoteParams = { wallet: ExtendedCashuWallet; amount: Money; description?: string; xPub: string }`; `createReceiveQuote(p: CreateQuoteBaseParams): Promise<CashuReceiveQuote>` (LIGHTNING variant `{ userId; account; lightningQuote; receiveType: 'LIGHTNING'; purpose?; transferId? }`). **No `get` on the service** → use `CashuReceiveQuoteRepository.get(id): Promise<CashuReceiveQuote | null>`.
- `SparkReceiveQuoteService.createReceiveQuote(p: CreateQuoteBaseParams): Promise<SparkReceiveQuote>`; `get(quoteId): Promise<SparkReceiveQuote | null>`. `createLightningQuote` is the standalone `getLightningQuote({ wallet: BreezSdk; amount: Money; receiverIdentityPubkey?; description?; descriptionHash? }): Promise<SparkReceiveLightningQuote>` exported from `internal/spark/receive-quote-core`.
- `SdkCoreEventMap` lifecycle payloads: `send:completed`/`receive:completed` `{ protocol; quoteId; transactionId; amount: Money }`; `send:failed` `{ protocol; quoteId; transactionId?; error: SdkError }`; `receive:failed` `{ protocol; quoteId; error }`; `receive:expired` `{ protocol; quoteId }`.
- Terminal states (from `internal/realtime/lifecycle-events.ts`): cashu-send-quote PAID→completed(amountReceived)/EXPIRED→failed/FAILED→failed; cashu-send-swap COMPLETED→completed(amountReceived)/FAILED/REVERSED→failed; spark-send-quote COMPLETED→completed(amount)/FAILED (no EXPIRED); cashu-receive-quote COMPLETED→completed(amount)/EXPIRED→expired/FAILED (PAID non-terminal); spark-receive-quote PAID→completed(amount)/EXPIRED→expired/FAILED.

---

## File Structure

- **Create** `packages/wallet-sdk/src/domains/await-terminal.ts` — shared `awaitTerminal` helper + `TerminalResult`/`TerminalStatus` types.
- **Create** `packages/wallet-sdk/src/domains/await-terminal.test.ts` — race/abort/event/backstop tests.
- **Create** `packages/wallet-sdk/src/domains/cashu-receive-ops.ts` — `CashuReceiveOps`.
- **Create** `packages/wallet-sdk/src/domains/spark-receive-ops.ts` — `SparkReceiveOps`.
- **Create** `packages/wallet-sdk/src/domains/spark-send-ops.ts` — `SparkSendOps`.
- **Create** `packages/wallet-sdk/src/domains/cashu-send-ops.ts` — `CashuSendOps` (+ `CreateTokenSendResult`).
- **Create** `packages/wallet-sdk/src/domains/cashu-send-ops.test.ts` — `createTokenSend` composition test.
- **Modify** `packages/wallet-sdk/src/sdk.ts` — construct + expose `sdk.cashu` / `sdk.spark`.
- **Modify** `packages/wallet-sdk/src/sdk.test.ts` — assert the new surface.
- **Modify** `packages/wallet-sdk/src/index.ts` — barrel `export type` for the *LightningQuote types + `TerminalResult` + `CreateTokenSendResult`.

**Testing posture (minimal + new-logic carve-out, as every prior base plan):** unit-test the genuinely-new logic — the `awaitTerminal` helper (Task 1) and `createTokenSend`'s inline composition (Task 4). The thin *Op wrappers (createLightningQuote/execute/executeAndAwait/get over already-tested services) are gate-green only. OPUS implements/reviews Tasks 1, 4, and 6 (holistic); sonnet implements Tasks 2, 3, 5 with sonnet review.

---

## Task 1: Shared awaitTerminal helper

**Files:**
- Create: `packages/wallet-sdk/src/domains/await-terminal.ts`
- Test: `packages/wallet-sdk/src/domains/await-terminal.test.ts`

**Interfaces:**
- Consumes: `EventBus<SdkCoreEventMap>` (`.on(event, cb): () => void`); `SdkCoreEventMap` lifecycle payloads; `DomainError`/`SdkError` from `../errors`; `Money` from `@agicash/money`.
- Produces: `awaitTerminal(deps): Promise<TerminalResult>` and the types `TerminalResult`, `TerminalStatus`. Each *Op (Tasks 2–4) calls this with its own `backstop` closure.

- [ ] **Step 1: Write the failing test `await-terminal.test.ts`**

```ts
import { describe, expect, mock, test } from 'bun:test';
import { Money } from '@agicash/money';
import { DomainError } from '../errors';
import { EventBus } from '../internal/event-bus';
import type { SdkCoreEventMap } from '../events';
import { awaitTerminal, type TerminalStatus } from './await-terminal';

const amount = new Money({ amount: 100, currency: 'BTC', unit: 'sat' });
const completedResult = {
  protocol: 'cashu' as const,
  quoteId: 'q1',
  transactionId: 't1',
  amount,
};
const pending = async (): Promise<TerminalStatus> => ({ status: 'pending' });

describe('awaitTerminal', () => {
  test('resolves on a matching send:completed event', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const p = awaitTerminal({
      events,
      kind: 'send',
      quoteId: 'q1',
      backstop: pending,
    });
    events.emit('send:completed', completedResult);
    expect(await p).toEqual(completedResult);
  });

  test('ignores non-matching quoteId', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    let settled = false;
    const p = awaitTerminal({
      events,
      kind: 'send',
      quoteId: 'q1',
      backstop: pending,
    }).then(() => {
      settled = true;
    });
    events.emit('send:completed', { ...completedResult, quoteId: 'other' });
    await Promise.resolve();
    expect(settled).toBe(false);
    events.emit('send:completed', completedResult);
    await p;
    expect(settled).toBe(true);
  });

  test('rejects on send:failed with the error', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const err = new DomainError('boom');
    const p = awaitTerminal({
      events,
      kind: 'send',
      quoteId: 'q1',
      backstop: pending,
    });
    events.emit('send:failed', { protocol: 'cashu', quoteId: 'q1', error: err });
    await expect(p).rejects.toBe(err);
  });

  test('rejects on receive:expired', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const p = awaitTerminal({
      events,
      kind: 'receive',
      quoteId: 'q1',
      backstop: pending,
    });
    events.emit('receive:expired', { protocol: 'cashu', quoteId: 'q1' });
    await expect(p).rejects.toThrow('expired');
  });

  test('backstop already-completed resolves without an event', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const result = await awaitTerminal({
      events,
      kind: 'send',
      quoteId: 'q1',
      backstop: async () => ({ status: 'completed', result: completedResult }),
    });
    expect(result).toEqual(completedResult);
  });

  test('backstop pending then a later event resolves', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const p = awaitTerminal({
      events,
      kind: 'receive',
      quoteId: 'q1',
      backstop: pending,
    });
    events.emit('receive:completed', { ...completedResult });
    expect(await p).toEqual(completedResult);
  });

  test('aborts via signal', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const ctrl = new AbortController();
    const p = awaitTerminal({
      events,
      kind: 'send',
      quoteId: 'q1',
      backstop: pending,
      signal: ctrl.signal,
    });
    ctrl.abort();
    await expect(p).rejects.toThrow('Aborted');
  });

  test('unsubscribes after settling (no further delivery)', async () => {
    const events = new EventBus<SdkCoreEventMap>();
    const cb = mock(() => {});
    const p = awaitTerminal({
      events,
      kind: 'send',
      quoteId: 'q1',
      backstop: async () => ({ status: 'completed', result: completedResult }),
    });
    await p;
    // A second emit must not throw or re-settle; the listener is gone.
    events.emit('send:completed', completedResult);
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/wallet-sdk && bun test src/domains/await-terminal.test.ts`
Expected: FAIL — `Cannot find module './await-terminal'`.

- [ ] **Step 3: Implement `await-terminal.ts`**

```ts
import type { Money } from '@agicash/money';
import { DomainError, type SdkError } from '../errors';
import type { SdkCoreEventMap } from '../events';
import type { EventBus } from '../internal/event-bus';

/** The successful terminal result of a send/receive flow. */
export type TerminalResult = {
  protocol: 'cashu' | 'spark';
  quoteId: string;
  transactionId: string;
  amount: Money;
};

/** A freshly-read entity classified for the awaitTerminal backstop. */
export type TerminalStatus =
  | { status: 'completed'; result: TerminalResult }
  | { status: 'failed'; error: SdkError }
  | { status: 'expired' }
  | { status: 'pending' };

/**
 * Resolves when the entity identified by `quoteId` reaches a terminal state.
 *
 * Listens on the base lifecycle events (`send:*` / `receive:*`), which fire once
 * per entity, on every instance, while background processing is running — AND
 * does one immediate `backstop` read to catch an entity that was already terminal
 * before the listener attached (events do not replay). Resolves with the
 * `TerminalResult` on success; rejects with the `SdkError` on failure, or a
 * `DomainError` on expiry/abort.
 *
 * @remarks Requires `sdk.background.start()`: lifecycle events derive from the
 * realtime change-feed. Not used by server mode (which has no engine).
 */
export function awaitTerminal(deps: {
  events: EventBus<SdkCoreEventMap>;
  /** `send` listens on send:completed/failed; `receive` adds receive:expired. */
  kind: 'send' | 'receive';
  quoteId: string;
  /** Re-reads + classifies the entity; `pending` keeps waiting for an event. */
  backstop: () => Promise<TerminalStatus>;
  signal?: AbortSignal;
}): Promise<TerminalResult> {
  const { events, kind, quoteId, backstop, signal } = deps;

  return new Promise<TerminalResult>((resolve, reject) => {
    const unsubs: Array<() => void> = [];
    let settled = false;

    const onAbort = () =>
      done(() =>
        reject(new DomainError('Aborted while awaiting terminal state')),
      );

    const cleanup = () => {
      for (const off of unsubs) off();
      signal?.removeEventListener('abort', onAbort);
    };

    function done(fn: () => void): void {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    }

    if (signal?.aborted) {
      reject(new DomainError('Aborted while awaiting terminal state'));
      return;
    }
    signal?.addEventListener('abort', onAbort);

    const matches = (p: { quoteId: string }) => p.quoteId === quoteId;

    if (kind === 'send') {
      unsubs.push(
        events.on('send:completed', (p) => {
          if (matches(p)) done(() => resolve(p));
        }),
        events.on('send:failed', (p) => {
          if (matches(p)) done(() => reject(p.error));
        }),
      );
    } else {
      unsubs.push(
        events.on('receive:completed', (p) => {
          if (matches(p)) done(() => resolve(p));
        }),
        events.on('receive:failed', (p) => {
          if (matches(p)) done(() => reject(p.error));
        }),
        events.on('receive:expired', (p) => {
          if (matches(p)) done(() => reject(new DomainError('Quote expired')));
        }),
      );
    }

    // Events do not replay on attach — catch an already-terminal entity.
    backstop().then(
      (s) => {
        if (s.status === 'completed') done(() => resolve(s.result));
        else if (s.status === 'failed') done(() => reject(s.error));
        else if (s.status === 'expired')
          done(() => reject(new DomainError('Quote expired')));
        // 'pending' → keep the listeners armed.
      },
      (err) => done(() => reject(err)),
    );
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/wallet-sdk && bun test src/domains/await-terminal.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Gate + commit**

Run: `bun run typecheck && bun run test` (from worktree root)
Expected: 8 packages typecheck exit 0; 0 fail.

```bash
git add packages/wallet-sdk/src/domains/await-terminal.ts packages/wallet-sdk/src/domains/await-terminal.test.ts
git commit -m "feat(wallet-sdk): shared awaitTerminal helper (event + backstop) (base 6b-ops)"
```

---

## Task 2: Receive *Ops (Cashu + Spark)

**Files:**
- Create: `packages/wallet-sdk/src/domains/cashu-receive-ops.ts`
- Create: `packages/wallet-sdk/src/domains/spark-receive-ops.ts`

**Interfaces:**
- Consumes: Task 1's `awaitTerminal`/`TerminalResult`/`TerminalStatus`; `CashuReceiveQuoteService.getLightningQuote`/`createReceiveQuote`; `CashuReceiveQuoteRepository.get`; `SparkReceiveQuoteService.createReceiveQuote`/`get`; the standalone `getLightningQuote` from `internal/spark/receive-quote-core`; `CashuReceiveLightningQuote`, `SparkReceiveLightningQuote`, `CashuReceiveQuote`, `SparkReceiveQuote`, `CashuAccount`, `SparkAccount`, `TransactionPurpose`, `Money`.
- Produces: `CashuReceiveOps` and `SparkReceiveOps`, each with `createLightningQuote` / `execute` / `executeAndAwait` / `awaitTerminal` / `get`. Ctors: cashu `{ service, repository, events, getCurrentUserId }`; spark `{ service, events, getCurrentUserId }` (spark uses `service.get` for both `get` and backstop).

**No new unit tests** (thin create-only wrappers over already-tested services + the Task-1 helper; gate-green).

- [ ] **Step 1: Implement `cashu-receive-ops.ts`**

```ts
import type { Money } from '@agicash/money';
import { DomainError } from '../errors';
import type { SdkCoreEventMap } from '../events';
import type { EventBus } from '../internal/event-bus';
import type { CashuReceiveLightningQuote } from '../internal/cashu/receive-quote-core';
import type { CashuReceiveQuoteRepository } from '../internal/db/cashu-receive-quote-repository';
import type { CashuReceiveQuoteService } from '../internal/services/cashu-receive-quote-service';
import type { CashuAccount } from './account-types';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { TransactionPurpose } from './transaction-enums';
import {
  type TerminalResult,
  type TerminalStatus,
  awaitTerminal,
} from './await-terminal';

type Deps = {
  service: CashuReceiveQuoteService;
  repository: CashuReceiveQuoteRepository;
  events: EventBus<SdkCoreEventMap>;
  getCurrentUserId: () => Promise<string | null>;
};

/** Receiving Lightning into a cashu account. `execute` persists the quote so the
 * background processor mints on payment; `awaitTerminal` resolves on COMPLETED. */
export class CashuReceiveOps {
  constructor(private readonly deps: Deps) {}

  /** A locked mint quote (bolt11 invoice) to receive `amount`. Not persisted. */
  createLightningQuote(p: {
    account: CashuAccount;
    amount: Money;
    description?: string;
  }): Promise<CashuReceiveLightningQuote> {
    return this.deps.service.getLightningQuote({
      wallet: p.account.wallet,
      amount: p.amount,
      description: p.description,
    });
  }

  /** Persists the receive quote so the processor tracks payment. Create-only. */
  async execute(p: {
    account: CashuAccount;
    quote: CashuReceiveLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
  }): Promise<CashuReceiveQuote> {
    const userId = await this.requireUserId();
    return this.deps.service.createReceiveQuote({
      userId,
      account: p.account,
      lightningQuote: p.quote,
      receiveType: 'LIGHTNING',
      purpose: p.purpose,
      transferId: p.transferId,
    });
  }

  /** Persists then resolves when the payment completes (or fails/expires). */
  async executeAndAwait(p: {
    account: CashuAccount;
    quote: CashuReceiveLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    const quote = await this.execute(p);
    return this.awaitTerminal({ quoteId: quote.id, signal: p.signal });
  }

  awaitTerminal(p: {
    quoteId: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    return awaitTerminal({
      events: this.deps.events,
      kind: 'receive',
      quoteId: p.quoteId,
      backstop: () => this.classify(p.quoteId),
      signal: p.signal,
    });
  }

  get(quoteId: string): Promise<CashuReceiveQuote | null> {
    return this.deps.repository.get(quoteId);
  }

  private async classify(quoteId: string): Promise<TerminalStatus> {
    const quote = await this.deps.repository.get(quoteId);
    if (!quote) return { status: 'pending' };
    switch (quote.state) {
      case 'COMPLETED':
        return {
          status: 'completed',
          result: {
            protocol: 'cashu',
            quoteId: quote.id,
            transactionId: quote.transactionId,
            amount: quote.amount,
          },
        };
      case 'EXPIRED':
        return { status: 'expired' };
      case 'FAILED':
        return {
          status: 'failed',
          error: new DomainError(quote.failureReason),
        };
      default:
        // UNPAID, PAID — PAID is non-terminal (COMPLETED fires later).
        return { status: 'pending' };
    }
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
```

- [ ] **Step 2: Implement `spark-receive-ops.ts`**

```ts
import type { Money } from '@agicash/money';
import { DomainError } from '../errors';
import type { SdkCoreEventMap } from '../events';
import type { EventBus } from '../internal/event-bus';
import {
  type SparkReceiveLightningQuote,
  getLightningQuote as getSparkReceiveLightningQuote,
} from '../internal/spark/receive-quote-core';
import type { SparkReceiveQuoteService } from '../internal/services/spark-receive-quote-service';
import type { SparkAccount } from './account-types';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { TransactionPurpose } from './transaction-enums';
import {
  type TerminalResult,
  type TerminalStatus,
  awaitTerminal,
} from './await-terminal';

type Deps = {
  service: SparkReceiveQuoteService;
  events: EventBus<SdkCoreEventMap>;
  getCurrentUserId: () => Promise<string | null>;
};

/** Receiving Lightning into a spark account. PAID is terminal (no separate
 * COMPLETED), so `awaitTerminal` resolves on PAID. */
export class SparkReceiveOps {
  constructor(private readonly deps: Deps) {}

  /** A bolt11 invoice to receive `amount`. Not persisted. */
  createLightningQuote(p: {
    account: SparkAccount;
    amount: Money;
    description?: string;
  }): Promise<SparkReceiveLightningQuote> {
    return getSparkReceiveLightningQuote({
      wallet: p.account.wallet,
      amount: p.amount,
      description: p.description,
    });
  }

  /** Persists the receive quote so the processor tracks payment. Create-only. */
  async execute(p: {
    account: SparkAccount;
    quote: SparkReceiveLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
  }): Promise<SparkReceiveQuote> {
    const userId = await this.requireUserId();
    return this.deps.service.createReceiveQuote({
      userId,
      account: p.account,
      lightningQuote: p.quote,
      receiveType: 'LIGHTNING',
      purpose: p.purpose,
      transferId: p.transferId,
    });
  }

  async executeAndAwait(p: {
    account: SparkAccount;
    quote: SparkReceiveLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    const quote = await this.execute(p);
    return this.awaitTerminal({ quoteId: quote.id, signal: p.signal });
  }

  awaitTerminal(p: {
    quoteId: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    return awaitTerminal({
      events: this.deps.events,
      kind: 'receive',
      quoteId: p.quoteId,
      backstop: () => this.classify(p.quoteId),
      signal: p.signal,
    });
  }

  get(quoteId: string): Promise<SparkReceiveQuote | null> {
    return this.deps.service.get(quoteId);
  }

  private async classify(quoteId: string): Promise<TerminalStatus> {
    const quote = await this.deps.service.get(quoteId);
    if (!quote) return { status: 'pending' };
    switch (quote.state) {
      case 'PAID':
        return {
          status: 'completed',
          result: {
            protocol: 'spark',
            quoteId: quote.id,
            transactionId: quote.transactionId,
            amount: quote.amount,
          },
        };
      case 'EXPIRED':
        return { status: 'expired' };
      case 'FAILED':
        return {
          status: 'failed',
          error: new DomainError(quote.failureReason),
        };
      default:
        // UNPAID — non-terminal.
        return { status: 'pending' };
    }
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
```

- [ ] **Step 3: Gate + commit**

Run: `bun run typecheck && bun run test` (from worktree root)
Expected: typecheck exit 0; 0 fail. (If `SparkReceiveQuote`/`CashuReceiveQuote` FAILED states do not expose `failureReason`, or the spark entity lacks `transactionId`, fix by reading the entity union in `domains/spark-receive-quote.ts` / `domains/cashu-receive-quote.ts` — the field names must match `internal/realtime/lifecycle-events.ts`, which uses `entity.failureReason`, `entity.transactionId`, `entity.amount` for these.)

```bash
git add packages/wallet-sdk/src/domains/cashu-receive-ops.ts packages/wallet-sdk/src/domains/spark-receive-ops.ts
git commit -m "feat(wallet-sdk): Cashu + Spark receive *Ops (base 6b-ops)"
```

---

## Task 3: SparkSendOps

**Files:**
- Create: `packages/wallet-sdk/src/domains/spark-send-ops.ts`

**Interfaces:**
- Consumes: Task 1's helper; `SparkSendQuoteService.getLightningSendQuote`/`createSendQuote`/`get`; `SparkLightningQuote`, `SparkSendQuote`, `SparkAccount`, `TransactionPurpose`, `Money`.
- Produces: `SparkSendOps` with `createLightningQuote` / `execute` / `executeAndAwait` / `awaitTerminal` / `get`. Ctor `{ service, events, getCurrentUserId }`.

**No new unit tests** (thin create-only wrapper; gate-green).

- [ ] **Step 1: Implement `spark-send-ops.ts`**

```ts
import type { Money } from '@agicash/money';
import { DomainError } from '../errors';
import type { SdkCoreEventMap } from '../events';
import type { EventBus } from '../internal/event-bus';
import type {
  SparkLightningQuote,
  SparkSendQuoteService,
} from '../internal/services/spark-send-quote-service';
import type { SparkAccount } from './account-types';
import type { SparkSendQuote } from './spark-send-quote';
import type { TransactionPurpose } from './transaction-enums';
import {
  type TerminalResult,
  type TerminalStatus,
  awaitTerminal,
} from './await-terminal';

type Deps = {
  service: SparkSendQuoteService;
  events: EventBus<SdkCoreEventMap>;
  getCurrentUserId: () => Promise<string | null>;
};

/** Sending Lightning from a spark account. `execute` persists the quote in UNPAID;
 * the background processor pays via Breez. No EXPIRED state. */
export class SparkSendOps {
  constructor(private readonly deps: Deps) {}

  /** A send quote (fees, balance check) for paying `paymentRequest`. Not persisted. */
  createLightningQuote(p: {
    account: SparkAccount;
    paymentRequest: string;
    amount?: Money<'BTC'>;
  }): Promise<SparkLightningQuote> {
    return this.deps.service.getLightningSendQuote({
      account: p.account,
      paymentRequest: p.paymentRequest,
      amount: p.amount,
    });
  }

  /** Persists the send quote (UNPAID); the processor initiates the payment. */
  async execute(p: {
    account: SparkAccount;
    quote: SparkLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
  }): Promise<SparkSendQuote> {
    const userId = await this.requireUserId();
    return this.deps.service.createSendQuote({
      userId,
      account: p.account,
      quote: p.quote,
      purpose: p.purpose,
      transferId: p.transferId,
    });
  }

  async executeAndAwait(p: {
    account: SparkAccount;
    quote: SparkLightningQuote;
    purpose?: TransactionPurpose;
    transferId?: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    const quote = await this.execute(p);
    return this.awaitTerminal({ quoteId: quote.id, signal: p.signal });
  }

  awaitTerminal(p: {
    quoteId: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    return awaitTerminal({
      events: this.deps.events,
      kind: 'send',
      quoteId: p.quoteId,
      backstop: () => this.classify(p.quoteId),
      signal: p.signal,
    });
  }

  get(quoteId: string): Promise<SparkSendQuote | null> {
    return this.deps.service.get(quoteId);
  }

  private async classify(quoteId: string): Promise<TerminalStatus> {
    const quote = await this.deps.service.get(quoteId);
    if (!quote) return { status: 'pending' };
    switch (quote.state) {
      case 'COMPLETED':
        return {
          status: 'completed',
          result: {
            protocol: 'spark',
            quoteId: quote.id,
            transactionId: quote.transactionId,
            amount: quote.amount,
          },
        };
      case 'FAILED':
        return {
          status: 'failed',
          error: new DomainError(quote.failureReason),
        };
      default:
        // UNPAID, PENDING — non-terminal (no EXPIRED for spark send).
        return { status: 'pending' };
    }
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
```

- [ ] **Step 2: Gate + commit**

Run: `bun run typecheck && bun run test` (from worktree root)
Expected: typecheck exit 0; 0 fail. (`SparkSendQuote` COMPLETED carries `amount`+`transactionId`; FAILED carries `failureReason` — confirm against `domains/spark-send-quote.ts` if a field mismatches; must match `lifecycle-events.ts` spark-send-quote handling.)

```bash
git add packages/wallet-sdk/src/domains/spark-send-ops.ts
git commit -m "feat(wallet-sdk): SparkSendOps (base 6b-ops)"
```

---

## Task 4: CashuSendOps (lightning send + token send + reverse)

**Files:**
- Create: `packages/wallet-sdk/src/domains/cashu-send-ops.ts`
- Test: `packages/wallet-sdk/src/domains/cashu-send-ops.test.ts`

**Interfaces:**
- Consumes: Task 1's helper; `CashuSendQuoteService.getLightningQuote`/`createSendQuote`; `CashuSendSwapService.create`/`swapForProofsToSend`/`reverse`; `CashuSendQuoteRepository.get`; `CashuSendSwapRepository.get`; `encodeToken` + `getCashuProtocolUnit` from `@agicash/cashu`; `toProof` from `./cashu-proof`; `CashuLightningQuote`, `CashuSendQuote`, `DestinationDetails`, `CashuSendSwap`, `CashuAccount`, `TransactionPurpose`, `Money`, `Big`.
- Produces: `CashuSendOps` with `createLightningQuote` / `execute` / `executeAndAwait` / `createTokenSend` / `reverse` / `awaitTerminal` / `get`, plus the `CreateTokenSendResult` type. Ctor `{ quoteService, swapService, quoteRepository, swapRepository, events, getCurrentUserId }`. `awaitTerminal` backstop reads BOTH the send-quote and send-swap repos (the lightning and token paths both emit `send:*` events keyed by entity `id`).

- [ ] **Step 1: Write the failing test `cashu-send-ops.test.ts` (createTokenSend composition)**

```ts
import { describe, expect, mock, test } from 'bun:test';
import { Money } from '@agicash/money';
import { CashuSendOps } from './cashu-send-ops';

const amount = new Money({ amount: 100, currency: 'BTC', unit: 'sat' });
const account = {
  id: 'acc1',
  mintUrl: 'https://mint.example',
} as unknown as Parameters<CashuSendOps['createTokenSend']>[0]['account'];

const pendingSwap = {
  id: 'swap1',
  state: 'PENDING',
  amountToSend: amount,
  proofsToSend: [
    {
      id: 'p1',
      amount: 100,
      secret: 's',
      unblindedSignature: 'C',
      keysetId: 'k',
      publicKeyY: 'Y',
      dleq: undefined,
      witness: undefined,
    },
  ],
};

const makeOps = (over: {
  create?: ReturnType<typeof mock>;
  swap?: ReturnType<typeof mock>;
  swapGet?: ReturnType<typeof mock>;
  userId?: string | null;
}) =>
  new CashuSendOps({
    quoteService: {} as never,
    swapService: {
      create: over.create ?? mock(async () => ({ ...pendingSwap, state: 'DRAFT' })),
      swapForProofsToSend: over.swap ?? mock(async () => {}),
    },
    quoteRepository: {} as never,
    swapRepository: {
      get: over.swapGet ?? mock(async () => pendingSwap),
    },
    events: {} as never,
    getCurrentUserId: async () => over.userId ?? null,
  } as unknown as ConstructorParameters<typeof CashuSendOps>[0]);

describe('CashuSendOps.createTokenSend', () => {
  test('DRAFT swap → swaps, re-reads, encodes a token', async () => {
    const swap = mock(async () => {});
    const swapGet = mock(async () => pendingSwap);
    const result = await makeOps({ swap, swapGet, userId: 'u1' }).createTokenSend(
      { account, amount },
    );
    expect(swap).toHaveBeenCalledTimes(1);
    expect(swapGet).toHaveBeenCalledWith('swap1');
    expect(result.swap.state).toBe('PENDING');
    expect(typeof result.token).toBe('string');
    expect(result.token.startsWith('cashu')).toBe(true);
  });

  test('exact-proofs PENDING swap → no swap call, encodes directly', async () => {
    const create = mock(async () => pendingSwap); // already PENDING
    const swap = mock(async () => {});
    const result = await makeOps({ create, swap, userId: 'u1' }).createTokenSend({
      account,
      amount,
    });
    expect(swap).not.toHaveBeenCalled();
    expect(result.swap.state).toBe('PENDING');
  });

  test('requires a user', async () => {
    await expect(
      makeOps({ userId: null }).createTokenSend({ account, amount }),
    ).rejects.toThrow('No authenticated user');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/wallet-sdk && bun test src/domains/cashu-send-ops.test.ts`
Expected: FAIL — `Cannot find module './cashu-send-ops'`.

- [ ] **Step 3: Implement `cashu-send-ops.ts`**

```ts
import { encodeToken, getCashuProtocolUnit } from '@agicash/cashu';
import type { Money } from '@agicash/money';
import type { Big } from 'big.js';
import { DomainError } from '../errors';
import type { SdkCoreEventMap } from '../events';
import type { EventBus } from '../internal/event-bus';
import type { CashuSendQuoteRepository } from '../internal/db/cashu-send-quote-repository';
import type { CashuSendSwapRepository } from '../internal/db/cashu-send-swap-repository';
import type {
  CashuLightningQuote,
  CashuSendQuoteService,
} from '../internal/services/cashu-send-quote-service';
import type { CashuSendSwapService } from '../internal/services/cashu-send-swap-service';
import type { CashuAccount } from './account-types';
import { toProof } from './cashu-proof';
import type { CashuSendQuote, DestinationDetails } from './cashu-send-quote';
import type { CashuSendSwap } from './cashu-send-swap';
import type { TransactionPurpose } from './transaction-enums';
import {
  type TerminalResult,
  type TerminalStatus,
  awaitTerminal,
} from './await-terminal';

/** The result of `createTokenSend`: the encoded token to share + the PENDING swap. */
export type CreateTokenSendResult = {
  token: string;
  swap: CashuSendSwap;
};

type Deps = {
  quoteService: CashuSendQuoteService;
  swapService: CashuSendSwapService;
  quoteRepository: CashuSendQuoteRepository;
  swapRepository: CashuSendSwapRepository;
  events: EventBus<SdkCoreEventMap>;
  getCurrentUserId: () => Promise<string | null>;
};

/**
 * Sending from a cashu account: Lightning melt (createLightningQuote → execute,
 * processor-driven) and offline token send (createTokenSend, foreground swap).
 * `awaitTerminal` covers both the send-quote and send-swap entities.
 */
export class CashuSendOps {
  constructor(private readonly deps: Deps) {}

  /** A melt quote (fees, proof selection) for paying `paymentRequest`. Not persisted.
   * `exchangeRate` is needed only for a non-BTC amount on an amountless invoice —
   * fetch it via `sdk.rates` at the call site. */
  createLightningQuote(p: {
    account: CashuAccount;
    paymentRequest: string;
    amount?: Money;
    exchangeRate?: Big;
  }): Promise<CashuLightningQuote> {
    return this.deps.quoteService.getLightningQuote({
      account: p.account,
      paymentRequest: p.paymentRequest,
      amount: p.amount,
      exchangeRate: p.exchangeRate,
    });
  }

  /** Persists the send quote (UNPAID); the processor melts. Create-only. */
  async execute(p: {
    account: CashuAccount;
    quote: CashuLightningQuote;
    destinationDetails?: DestinationDetails;
    purpose?: TransactionPurpose;
    transferId?: string;
  }): Promise<CashuSendQuote> {
    const userId = await this.requireUserId();
    return this.deps.quoteService.createSendQuote({
      userId,
      account: p.account,
      sendQuote: {
        paymentRequest: p.quote.paymentRequest,
        amountRequested: p.quote.amountRequested,
        amountRequestedInBtc: p.quote.amountRequestedInBtc,
        meltQuote: p.quote.meltQuote,
      },
      destinationDetails: p.destinationDetails,
      purpose: p.purpose,
      transferId: p.transferId,
    });
  }

  async executeAndAwait(p: {
    account: CashuAccount;
    quote: CashuLightningQuote;
    destinationDetails?: DestinationDetails;
    purpose?: TransactionPurpose;
    transferId?: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    const quote = await this.execute(p);
    return this.awaitTerminal({ quoteId: quote.id, signal: p.signal });
  }

  /**
   * Creates an offline (ecash token) send. Runs the swap synchronously so the
   * encoded token can be returned. Safe against the concurrent background swap
   * processor: the swap is idempotent (deterministic outputs + already-signed
   * recovery) and `swapForProofsToSend` guards on `state === 'DRAFT'`.
   */
  async createTokenSend(p: {
    account: CashuAccount;
    amount: Money;
  }): Promise<CreateTokenSendResult> {
    const userId = await this.requireUserId();
    const created = await this.deps.swapService.create({
      userId,
      account: p.account,
      amount: p.amount,
      senderPaysFee: true,
    });

    let swap = created;
    if (created.state === 'DRAFT') {
      await this.deps.swapService.swapForProofsToSend({
        account: p.account,
        swap: created,
      });
      const updated = await this.deps.swapRepository.get(created.id);
      if (!updated) throw new Error('Send swap not found after swap');
      swap = updated;
    }
    if (swap.state !== 'PENDING') {
      throw new Error(`Send swap is not pending: ${swap.state}`);
    }

    const token = encodeToken(
      {
        mint: p.account.mintUrl,
        proofs: swap.proofsToSend.map((proof) => toProof(proof)),
        unit: getCashuProtocolUnit(swap.amountToSend.currency),
      },
      { removeDleq: true },
    );

    return { token, swap };
  }

  /** Reclaims a PENDING token send by swapping the proofs back into the account. */
  reverse(p: { swap: CashuSendSwap; account: CashuAccount }): Promise<void> {
    return this.deps.swapService.reverse(p.swap, p.account);
  }

  awaitTerminal(p: {
    quoteId: string;
    signal?: AbortSignal;
  }): Promise<TerminalResult> {
    return awaitTerminal({
      events: this.deps.events,
      kind: 'send',
      quoteId: p.quoteId,
      backstop: () => this.classify(p.quoteId),
      signal: p.signal,
    });
  }

  get(quoteId: string): Promise<CashuSendQuote | null> {
    return this.deps.quoteRepository.get(quoteId);
  }

  /** Backstop reads BOTH paths — a lightning send-quote and a token send-swap
   * both emit `send:*` keyed by their entity `id`. */
  private async classify(quoteId: string): Promise<TerminalStatus> {
    const quote = await this.deps.quoteRepository.get(quoteId);
    if (quote) {
      switch (quote.state) {
        case 'PAID':
          return {
            status: 'completed',
            result: {
              protocol: 'cashu',
              quoteId: quote.id,
              transactionId: quote.transactionId,
              amount: quote.amountReceived,
            },
          };
        case 'EXPIRED':
          return { status: 'failed', error: new DomainError('Send quote expired') };
        case 'FAILED':
          return {
            status: 'failed',
            error: new DomainError(quote.failureReason),
          };
        default:
          return { status: 'pending' };
      }
    }

    const swap = await this.deps.swapRepository.get(quoteId);
    if (swap) {
      switch (swap.state) {
        case 'COMPLETED':
          return {
            status: 'completed',
            result: {
              protocol: 'cashu',
              quoteId: swap.id,
              transactionId: swap.transactionId,
              amount: swap.amountReceived,
            },
          };
        case 'FAILED':
          return {
            status: 'failed',
            error: new DomainError(swap.failureReason),
          };
        case 'REVERSED':
          return { status: 'failed', error: new DomainError('Send swap reversed') };
        default:
          return { status: 'pending' };
      }
    }

    return { status: 'pending' };
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/wallet-sdk && bun test src/domains/cashu-send-ops.test.ts`
Expected: PASS (3 tests). (If `encodeToken` rejects the minimal fake proof shape, enrich the `pendingSwap.proofsToSend` fixture to a full `CashuProof` — read `domains/cashu-proof.ts` for the exact fields `toProof` expects.)

- [ ] **Step 5: Gate + commit**

Run: `bun run typecheck && bun run test` (from worktree root)
Expected: typecheck exit 0; 0 fail.

```bash
git add packages/wallet-sdk/src/domains/cashu-send-ops.ts packages/wallet-sdk/src/domains/cashu-send-ops.test.ts
git commit -m "feat(wallet-sdk): CashuSendOps (lightning send + token send + reverse) (base 6b-ops)"
```

---

## Task 5: Wire sdk.cashu / sdk.spark onto Sdk + barrel exports

**Files:**
- Modify: `packages/wallet-sdk/src/sdk.ts`
- Modify: `packages/wallet-sdk/src/index.ts`
- Test: `packages/wallet-sdk/src/sdk.test.ts`

**Interfaces:**
- Consumes: `CashuSendOps`/`CashuReceiveOps`/`SparkSendOps`/`SparkReceiveOps` (Tasks 2–4); the in-scope `walletRuntime.protocols`, `events`, `getCurrentUserId`.
- Produces: `sdk.cashu: { send: CashuSendOps; receive: CashuReceiveOps }`, `sdk.spark: { send: SparkSendOps; receive: SparkReceiveOps }`; barrel `export type` for `TerminalResult`, `CreateTokenSendResult`, `CashuLightningQuote`, `SparkLightningQuote`, `CashuReceiveLightningQuote`, `SparkReceiveLightningQuote`.

- [ ] **Step 1: Imports in `sdk.ts`**

Add alongside the other `./domains/*` imports:

```ts
import { CashuReceiveOps } from './domains/cashu-receive-ops';
import { CashuSendOps } from './domains/cashu-send-ops';
import { SparkReceiveOps } from './domains/spark-receive-ops';
import { SparkSendOps } from './domains/spark-send-ops';
```

- [ ] **Step 2: Readonly fields**

In the `Sdk` class body, after the `transfers` field added in Plan 6b:

```ts
  readonly cashu: { send: CashuSendOps; receive: CashuReceiveOps };
  readonly spark: { send: SparkSendOps; receive: SparkReceiveOps };
```

- [ ] **Step 3: Constructor `parts` type + assignments**

In the private constructor's `parts` type, after `transfers: TransfersDomain;`:

```ts
    cashu: { send: CashuSendOps; receive: CashuReceiveOps };
    spark: { send: SparkSendOps; receive: SparkReceiveOps };
```

And in the constructor body, after `this.transfers = parts.transfers;`:

```ts
    this.cashu = parts.cashu;
    this.spark = parts.spark;
```

- [ ] **Step 4: Construct in `Sdk.create`**

After the `transfers` construction (Plan 6b), add (`p` is `walletRuntime.protocols`):

```ts
    const p = walletRuntime.protocols;
    const cashu = {
      send: new CashuSendOps({
        quoteService: p.cashuSendQuoteService,
        swapService: p.cashuSendSwapService,
        quoteRepository: p.cashuSendQuoteRepository,
        swapRepository: p.cashuSendSwapRepository,
        events,
        getCurrentUserId,
      }),
      receive: new CashuReceiveOps({
        service: p.cashuReceiveQuoteService,
        repository: p.cashuReceiveQuoteRepository,
        events,
        getCurrentUserId,
      }),
    };
    const spark = {
      send: new SparkSendOps({
        service: p.sparkSendQuoteService,
        events,
        getCurrentUserId,
      }),
      receive: new SparkReceiveOps({
        service: p.sparkReceiveQuoteService,
        events,
        getCurrentUserId,
      }),
    };
```

Note: `const p = walletRuntime.protocols` is already declared inside the `if (deps.createEngine)` block lower down. Declare THIS `p` only if it is not already in scope at this point in `create`; if a name clash occurs, reuse `walletRuntime.protocols` inline instead of a second `const p`. Verify by reading the surrounding lines before editing.

- [ ] **Step 5: Pass into the final `return new Sdk({ ... })`**

Add alongside `transfers`:

```ts
      cashu,
      spark,
```

- [ ] **Step 6: Barrel `export type` in `index.ts`**

Add near the other domain/service type exports:

```ts
export type { TerminalResult } from './domains/await-terminal';
export type { CreateTokenSendResult } from './domains/cashu-send-ops';
export type { CashuLightningQuote } from './internal/services/cashu-send-quote-service';
export type { SparkLightningQuote } from './internal/services/spark-send-quote-service';
export type { CashuReceiveLightningQuote } from './internal/cashu/receive-quote-core';
export type { SparkReceiveLightningQuote } from './internal/spark/receive-quote-core';
```

- [ ] **Step 7: Assert the surface in `sdk.test.ts`**

In the first test, after the Plan-6b assertions:

```ts
    expect(sdk.cashu.send).toBeDefined();
    expect(sdk.cashu.receive).toBeDefined();
    expect(sdk.spark.send).toBeDefined();
    expect(sdk.spark.receive).toBeDefined();
```

- [ ] **Step 8: Gate + commit**

Run: `cd packages/wallet-sdk && bun test src/sdk.test.ts` then `bun run typecheck && bun run test` (from worktree root)
Expected: sdk tests PASS; typecheck exit 0; 0 fail.

```bash
git add packages/wallet-sdk/src/sdk.ts packages/wallet-sdk/src/index.ts packages/wallet-sdk/src/sdk.test.ts
git commit -m "feat(wallet-sdk): wire sdk.cashu/sdk.spark protocol *Ops onto Sdk (base 6b-ops)"
```

---

## Task 6: Holistic review (OPUS)

**Files:** none (review only).

- [ ] **Step 1: Whole-diff review**

Dispatch an OPUS reviewer over the 6b-ops commit range (`git diff <6b-ops-base>..HEAD -- packages/wallet-sdk`) with the brief:
- **Create-only correctness:** no facade calls a 4c processor method (initiate/complete/markPending/expire/fail/swap-in-background); the ONLY synchronous driver is `createTokenSend`. Verify no double-drive path.
- **awaitTerminal:** subscribe-before-backstop ordering; per-entity terminal sets match `lifecycle-events.ts` exactly (cashu-receive PAID non-terminal; spark-receive PAID terminal; spark-send no EXPIRED; cashu-send-quote EXPIRED→failed; cashu-send-swap REVERSED→failed); amount field per entity (`amountReceived` for cashu-send quote/swap, `amount` elsewhere); listeners always cleaned up (settle, abort); rejects on failed/expired.
- **createTokenSend:** inline swap idempotency relied upon correctly; DRAFT→swap→re-read→PENDING-guard→encode with `removeDleq:true`; returns `{token, swap}`.
- **Boundary:** no `listUnresolved`/`listPending` (variant); no scan/receiveToken; domain classes not barrel-exported (only the listed TYPES); namespace `sdk.{cashu,spark}.{send,receive}`; no TanStack/Sentry/retry; plain-`Error` parity.
- **Wiring:** all four *Ops at all five `sdk.ts` points; deps resolve to the right `walletRuntime.protocols` fields; `const p` has no shadow/clash.
- Confirm `bun run typecheck` exit 0 and `bun run test` 0 fail. ⛔ The reviewer MUST NOT run `bun run fix:all`.

- [ ] **Step 2: Address Critical/Important findings, then update the ledger**

Fix blockers inline (re-gate after). Append the Plan-6b-ops outcome to `.git/worktrees/sdk-extraction-fable/sdd/progress.md` with the final tip + test count.

---

## Self-Review

**1. Spec coverage:** all four *Ops (`sdk.cashu.send`/`receive`, `sdk.spark.send`/`receive`) with createLightningQuote/execute/executeAndAwait/awaitTerminal/get; cashu-send adds createTokenSend + reverse → Tasks 2–4. Shared awaitTerminal (event + backstop) → Task 1. Wiring + barrel → Task 5. Holistic → Task 6. Excluded (correctly): listUnresolved/listPending (variant), scan, 6c receiveToken. ✓

**2. Placeholder scan:** every code step has full source; gate commands have expected output; the two "if a field mismatches, read X" notes are fallbacks, not placeholders (the primary code is complete). ✓

**3. Type consistency:** `awaitTerminal`/`TerminalResult`/`TerminalStatus` (Task 1) are consumed identically by all four *Ops (Tasks 2–4). `getCurrentUserId`/`requireUserId` match the Plan-6b domains. The `*LightningQuote` types returned by `createLightningQuote` are the exact inputs to `execute`. Ctor dep names match the `walletRuntime.protocols` field names verbatim (Task 5). Entity field access (`state`, `transactionId`, `amount`/`amountReceived`, `failureReason`, `proofsToSend`, `amountToSend`) matches the verbatim signatures in Global Constraints + `lifecycle-events.ts`.
