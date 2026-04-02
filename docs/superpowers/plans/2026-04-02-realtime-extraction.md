# Realtime Handler Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract realtime change handling from web app React hooks into `@agicash/sdk`, making it available to CLI, daemon, and future MCP consumers.

**Architecture:** 8 plain factory functions produce `DatabaseChangeHandler[]` arrays (event → cache ops). A `RealtimeHandler` class subscribes to the Supabase broadcast channel and dispatches events. `WalletClient` gains `changeHandlers` and `createRealtimeHandler()`.

**Spec:** `docs/superpowers/specs/2026-04-02-realtime-extraction-design.md`

**Branch:** `agicash-cli`

**Note:** Spec execution steps 1-3 (cashu send swap extraction prerequisite) are already completed and reflected in the current `wallet-client.ts`. This plan starts at spec step 4.

**Parallelism:** Tasks 2-6 (change handler factories) are fully independent and can be dispatched simultaneously.

---

## File Structure

### New SDK files

| File | Responsibility |
|------|----------------|
| `packages/sdk/src/features/wallet/database-change-handler.ts` | `DatabaseChangeHandler` type + shared utilities |
| `packages/sdk/src/features/accounts/account-change-handlers.ts` | Account CREATED/UPDATED → cache ops |
| `packages/sdk/src/features/transactions/transaction-change-handlers.ts` | Transaction CREATED/UPDATED → cache ops + count invalidation |
| `packages/sdk/src/features/receive/cashu-receive-change-handlers.ts` | Cashu receive quote + swap CREATED/UPDATED → cache ops |
| `packages/sdk/src/features/send/cashu-send-change-handlers.ts` | Cashu send quote + swap CREATED/UPDATED → cache ops |
| `packages/sdk/src/features/receive/spark-receive-change-handlers.ts` | Spark receive quote CREATED/UPDATED → cache ops |
| `packages/sdk/src/features/send/spark-send-change-handlers.ts` | Spark send quote CREATED/UPDATED → cache ops |
| `packages/sdk/src/features/wallet/realtime-handler.ts` | `RealtimeHandler` class — channel subscription + event dispatch |

### Modified SDK files

| File | Change |
|------|--------|
| `packages/sdk/src/core/wallet-client.ts` | Add `changeHandlers` + `createRealtimeHandler()` |
| `packages/sdk/src/index.ts` | Export new types and classes |

### Modified web app files

| File | Change |
|------|--------|
| `app/features/accounts/account-hooks.ts` | Replace `useAccountChangeHandlers` with SDK import |
| `app/features/transactions/transaction-hooks.ts` | Replace `useTransactionChangeHandlers` with SDK import |
| `app/features/receive/cashu-receive-quote-hooks.ts` | Replace `useCashuReceiveQuoteChangeHandlers` with SDK import |
| `app/features/receive/cashu-receive-swap-hooks.ts` | Replace `useCashuReceiveSwapChangeHandlers` with SDK import |
| `app/features/send/cashu-send-quote-hooks.ts` | Replace `useCashuSendQuoteChangeHandlers` with SDK import |
| `app/features/send/cashu-send-swap-hooks.ts` | Replace `useCashuSendSwapChangeHandlers` with SDK import |
| `app/features/receive/spark-receive-quote-hooks.ts` | Replace `useSparkReceiveQuoteChangeHandlers` with SDK import |
| `app/features/send/spark-send-quote-hooks.ts` | Replace `useSparkSendQuoteChangeHandlers` with SDK import |
| `app/features/wallet/use-track-wallet-changes.ts` | Use `wallet.changeHandlers` instead of 8 hook calls |

---

## Reference: Payload Types

All payload types come from `@agicash/sdk/db/database` (already in SDK). All repo `.toXxx()` methods are async (decryption).

| Handler | Payload Type | Repo Method |
|---------|-------------|-------------|
| Account | `AgicashDbAccountWithProofs` | `accountRepo.toAccount(payload)` |
| Transaction | `AgicashDbTransaction` (UPDATED has `& { previous_acknowledgment_status }`) | `transactionRepo.toTransaction(payload)` |
| Cashu receive quote | `AgicashDbCashuReceiveQuote` | `cashuReceiveQuoteRepo.toQuote(payload)` |
| Cashu receive swap | `AgicashDbCashuReceiveSwap` | `cashuReceiveSwapRepo.toReceiveSwap(payload)` |
| Cashu send quote | `AgicashDbCashuSendQuote & { cashu_proofs: AgicashDbCashuProof[] }` | `cashuSendQuoteRepo.toQuote(payload)` |
| Cashu send swap | `AgicashDbCashuSendSwap & { cashu_proofs: AgicashDbCashuProof[] }` | `cashuSendSwapRepo.toSwap(payload)` |
| Spark receive quote | `AgicashDbSparkReceiveQuote` | `sparkReceiveQuoteRepo.toQuote(payload)` |
| Spark send quote | `AgicashDbSparkSendQuote` | `sparkSendQuoteRepo.toQuote(payload)` |

---

## Task 1: DatabaseChangeHandler type

**Files:**
- Create: `packages/sdk/src/features/wallet/database-change-handler.ts`

- [ ] Create the shared type file:

```typescript
// packages/sdk/src/features/wallet/database-change-handler.ts

export type DatabaseChangeHandler = {
  event: string;
  handleEvent: (payload: unknown) => void | Promise<void>;
};
```

- [ ] Verify: `bun run typecheck`
- [ ] Commit: `feat(sdk): add DatabaseChangeHandler type`

---

## Task 2: Account change handlers

**Files:**
- Create: `packages/sdk/src/features/accounts/account-change-handlers.ts`

Source reference: `app/features/accounts/account-hooks.ts` lines 33-53

- [ ] Create the factory function:

```typescript
// packages/sdk/src/features/accounts/account-change-handlers.ts

import type { AgicashDbAccountWithProofs } from '../../db/database';
import type { DatabaseChangeHandler } from '../wallet/database-change-handler';
import type { AccountsCache } from './account-queries';
import type { AccountRepository } from './account-repository';

export function createAccountChangeHandlers(
  accountRepo: AccountRepository,
  accountsCache: AccountsCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'ACCOUNT_CREATED',
      handleEvent: async (payload) => {
        const account = await accountRepo.toAccount(
          payload as AgicashDbAccountWithProofs,
        );
        accountsCache.upsert(account);
      },
    },
    {
      event: 'ACCOUNT_UPDATED',
      handleEvent: async (payload) => {
        const account = await accountRepo.toAccount(
          payload as AgicashDbAccountWithProofs,
        );
        accountsCache.update(account);
      },
    },
  ];
}
```

- [ ] Verify: `bun run typecheck`
- [ ] Commit: `feat(sdk): extract account change handlers`

---

## Task 3: Transaction change handlers

**Files:**
- Create: `packages/sdk/src/features/transactions/transaction-change-handlers.ts`

Source reference: `app/features/transactions/transaction-hooks.ts` lines 138-173

- [ ] Create the factory function. Note the extended payload type for UPDATED events:

```typescript
// packages/sdk/src/features/transactions/transaction-change-handlers.ts

import type { AgicashDbTransaction } from '../../db/database';
import type { Transaction } from '../transactions/transaction';
import type { DatabaseChangeHandler } from '../wallet/database-change-handler';
import type { TransactionsCache } from './transaction-queries';
import type { TransactionRepository } from './transaction-repository';

export function createTransactionChangeHandlers(
  transactionRepo: TransactionRepository,
  transactionsCache: TransactionsCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'TRANSACTION_CREATED',
      handleEvent: async (payload) => {
        const transaction = await transactionRepo.toTransaction(
          payload as AgicashDbTransaction,
        );
        transactionsCache.upsert(transaction);
        if (transaction.acknowledgmentStatus === 'pending') {
          transactionsCache.invalidateUnacknowledgedCount();
        }
      },
    },
    {
      event: 'TRANSACTION_UPDATED',
      handleEvent: async (payload) => {
        const typed = payload as AgicashDbTransaction & {
          previous_acknowledgment_status: Transaction['acknowledgmentStatus'];
        };
        const transaction = await transactionRepo.toTransaction(typed);
        transactionsCache.upsert(transaction);
        if (
          typed.previous_acknowledgment_status !==
          transaction.acknowledgmentStatus
        ) {
          transactionsCache.invalidateUnacknowledgedCount();
        }
      },
    },
  ];
}
```

- [ ] Verify: `bun run typecheck`
- [ ] Commit: `feat(sdk): extract transaction change handlers`

---

## Task 4: Cashu receive change handlers (quote + swap)

**Files:**
- Create: `packages/sdk/src/features/receive/cashu-receive-change-handlers.ts`

Source reference: `app/features/receive/cashu-receive-quote-hooks.ts` lines 131-161, `app/features/receive/cashu-receive-swap-hooks.ts` lines 48-76

- [ ] Create the factory functions (two in one file):

```typescript
// packages/sdk/src/features/receive/cashu-receive-change-handlers.ts

import type {
  AgicashDbCashuReceiveQuote,
  AgicashDbCashuReceiveSwap,
} from '../../db/database';
import type { DatabaseChangeHandler } from '../wallet/database-change-handler';
import type {
  CashuReceiveQuoteCache,
  PendingCashuReceiveQuotesCache,
} from './cashu-receive-queries';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import type { PendingCashuReceiveSwapsCache } from './cashu-receive-swap-queries';
import type { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';

export function createCashuReceiveQuoteChangeHandlers(
  cashuReceiveQuoteRepo: CashuReceiveQuoteRepository,
  cashuReceiveQuoteCache: CashuReceiveQuoteCache,
  pendingCashuReceiveQuotesCache: PendingCashuReceiveQuotesCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'CASHU_RECEIVE_QUOTE_CREATED',
      handleEvent: async (payload) => {
        const quote = await cashuReceiveQuoteRepo.toQuote(
          payload as AgicashDbCashuReceiveQuote,
        );
        pendingCashuReceiveQuotesCache.add(quote);
      },
    },
    {
      event: 'CASHU_RECEIVE_QUOTE_UPDATED',
      handleEvent: async (payload) => {
        const quote = await cashuReceiveQuoteRepo.toQuote(
          payload as AgicashDbCashuReceiveQuote,
        );
        cashuReceiveQuoteCache.updateIfExists(quote);
        if (quote.state === 'UNPAID' || quote.state === 'PAID') {
          pendingCashuReceiveQuotesCache.update(quote);
        } else {
          pendingCashuReceiveQuotesCache.remove(quote);
        }
      },
    },
  ];
}

export function createCashuReceiveSwapChangeHandlers(
  cashuReceiveSwapRepo: CashuReceiveSwapRepository,
  pendingCashuReceiveSwapsCache: PendingCashuReceiveSwapsCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'CASHU_RECEIVE_SWAP_CREATED',
      handleEvent: async (payload) => {
        const swap = await cashuReceiveSwapRepo.toReceiveSwap(
          payload as AgicashDbCashuReceiveSwap,
        );
        pendingCashuReceiveSwapsCache.add(swap);
      },
    },
    {
      event: 'CASHU_RECEIVE_SWAP_UPDATED',
      handleEvent: async (payload) => {
        const swap = await cashuReceiveSwapRepo.toReceiveSwap(
          payload as AgicashDbCashuReceiveSwap,
        );
        if (swap.state === 'PENDING') {
          pendingCashuReceiveSwapsCache.update(swap);
        } else {
          pendingCashuReceiveSwapsCache.remove(swap);
        }
      },
    },
  ];
}
```

- [ ] Verify: `bun run typecheck`
- [ ] Commit: `feat(sdk): extract cashu receive change handlers`

---

## Task 5: Cashu send change handlers (quote + swap)

**Files:**
- Create: `packages/sdk/src/features/send/cashu-send-change-handlers.ts`

Source reference: `app/features/send/cashu-send-quote-hooks.ts` lines 118-151, `app/features/send/cashu-send-swap-hooks.ts` lines 255-291

- [ ] Create the factory functions. Note the extended payload types with `cashu_proofs`:

```typescript
// packages/sdk/src/features/send/cashu-send-change-handlers.ts

import type {
  AgicashDbCashuProof,
  AgicashDbCashuSendQuote,
  AgicashDbCashuSendSwap,
} from '../../db/database';
import type { DatabaseChangeHandler } from '../wallet/database-change-handler';
import type { UnresolvedCashuSendQuotesCache } from './cashu-send-quote-queries';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import type {
  CashuSendSwapCache,
  UnresolvedCashuSendSwapsCache,
} from './cashu-send-swap-queries';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';

export function createCashuSendQuoteChangeHandlers(
  cashuSendQuoteRepo: CashuSendQuoteRepository,
  unresolvedCashuSendQuotesCache: UnresolvedCashuSendQuotesCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'CASHU_SEND_QUOTE_CREATED',
      handleEvent: async (payload) => {
        const quote = await cashuSendQuoteRepo.toQuote(
          payload as AgicashDbCashuSendQuote & {
            cashu_proofs: AgicashDbCashuProof[];
          },
        );
        unresolvedCashuSendQuotesCache.add(quote);
      },
    },
    {
      event: 'CASHU_SEND_QUOTE_UPDATED',
      handleEvent: async (payload) => {
        const quote = await cashuSendQuoteRepo.toQuote(
          payload as AgicashDbCashuSendQuote & {
            cashu_proofs: AgicashDbCashuProof[];
          },
        );
        if (quote.state === 'UNPAID' || quote.state === 'PENDING') {
          unresolvedCashuSendQuotesCache.update(quote);
        } else {
          unresolvedCashuSendQuotesCache.remove(quote);
        }
      },
    },
  ];
}

export function createCashuSendSwapChangeHandlers(
  cashuSendSwapRepo: CashuSendSwapRepository,
  cashuSendSwapCache: CashuSendSwapCache,
  unresolvedCashuSendSwapsCache: UnresolvedCashuSendSwapsCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'CASHU_SEND_SWAP_CREATED',
      handleEvent: async (payload) => {
        const swap = await cashuSendSwapRepo.toSwap(
          payload as AgicashDbCashuSendSwap & {
            cashu_proofs: AgicashDbCashuProof[];
          },
        );
        unresolvedCashuSendSwapsCache.add(swap);
      },
    },
    {
      event: 'CASHU_SEND_SWAP_UPDATED',
      handleEvent: async (payload) => {
        const swap = await cashuSendSwapRepo.toSwap(
          payload as AgicashDbCashuSendSwap & {
            cashu_proofs: AgicashDbCashuProof[];
          },
        );
        cashuSendSwapCache.updateIfExists(swap);
        if (swap.state === 'DRAFT' || swap.state === 'PENDING') {
          unresolvedCashuSendSwapsCache.update(swap);
        } else {
          unresolvedCashuSendSwapsCache.remove(swap);
        }
      },
    },
  ];
}
```

- [ ] Verify: `bun run typecheck`
- [ ] Commit: `feat(sdk): extract cashu send change handlers`

---

## Task 6: Spark change handlers (receive + send)

**Files:**
- Create: `packages/sdk/src/features/receive/spark-receive-change-handlers.ts`
- Create: `packages/sdk/src/features/send/spark-send-change-handlers.ts`

Source reference: `app/features/receive/spark-receive-quote-hooks.ts` lines 95-125, `app/features/send/spark-send-quote-hooks.ts` lines 29-57

- [ ] Create spark receive change handlers:

```typescript
// packages/sdk/src/features/receive/spark-receive-change-handlers.ts

import type { AgicashDbSparkReceiveQuote } from '../../db/database';
import type { DatabaseChangeHandler } from '../wallet/database-change-handler';
import type {
  PendingSparkReceiveQuotesCache,
  SparkReceiveQuoteCache,
} from './spark-receive-queries';
import type { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';

export function createSparkReceiveQuoteChangeHandlers(
  sparkReceiveQuoteRepo: SparkReceiveQuoteRepository,
  sparkReceiveQuoteCache: SparkReceiveQuoteCache,
  pendingSparkReceiveQuotesCache: PendingSparkReceiveQuotesCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'SPARK_RECEIVE_QUOTE_CREATED',
      handleEvent: async (payload) => {
        const quote = await sparkReceiveQuoteRepo.toQuote(
          payload as AgicashDbSparkReceiveQuote,
        );
        pendingSparkReceiveQuotesCache.add(quote);
      },
    },
    {
      event: 'SPARK_RECEIVE_QUOTE_UPDATED',
      handleEvent: async (payload) => {
        const quote = await sparkReceiveQuoteRepo.toQuote(
          payload as AgicashDbSparkReceiveQuote,
        );
        sparkReceiveQuoteCache.updateIfExists(quote);
        if (quote.state === 'UNPAID') {
          pendingSparkReceiveQuotesCache.update(quote);
        } else {
          pendingSparkReceiveQuotesCache.remove(quote);
        }
      },
    },
  ];
}
```

- [ ] Create spark send change handlers:

```typescript
// packages/sdk/src/features/send/spark-send-change-handlers.ts

import type { AgicashDbSparkSendQuote } from '../../db/database';
import type { DatabaseChangeHandler } from '../wallet/database-change-handler';
import type { UnresolvedSparkSendQuotesCache } from './spark-send-quote-queries';
import type { SparkSendQuoteRepository } from './spark-send-quote-repository';

export function createSparkSendQuoteChangeHandlers(
  sparkSendQuoteRepo: SparkSendQuoteRepository,
  unresolvedSparkSendQuotesCache: UnresolvedSparkSendQuotesCache,
): DatabaseChangeHandler[] {
  return [
    {
      event: 'SPARK_SEND_QUOTE_CREATED',
      handleEvent: async (payload) => {
        const quote = await sparkSendQuoteRepo.toQuote(
          payload as AgicashDbSparkSendQuote,
        );
        unresolvedSparkSendQuotesCache.add(quote);
      },
    },
    {
      event: 'SPARK_SEND_QUOTE_UPDATED',
      handleEvent: async (payload) => {
        const quote = await sparkSendQuoteRepo.toQuote(
          payload as AgicashDbSparkSendQuote,
        );
        if (quote.state === 'UNPAID' || quote.state === 'PENDING') {
          unresolvedSparkSendQuotesCache.update(quote);
        } else {
          unresolvedSparkSendQuotesCache.remove(quote);
        }
      },
    },
  ];
}
```

- [ ] Verify: `bun run typecheck`
- [ ] Commit: `feat(sdk): extract spark change handlers`

---

## Task 7: RealtimeHandler class

**Files:**
- Create: `packages/sdk/src/features/wallet/realtime-handler.ts`

The `SupabaseRealtimeManager` is already in the SDK at `packages/sdk/src/lib/supabase/supabase-realtime-manager.ts`. It provides `channel()` → `addChannel()` → `subscribe()` → `removeChannel()`.

- [ ] Create the RealtimeHandler class:

```typescript
// packages/sdk/src/features/wallet/realtime-handler.ts

import type { SupabaseRealtimeManager } from '../../lib/supabase/supabase-realtime-manager';
import type { DatabaseChangeHandler } from './database-change-handler';

export type RealtimeHandlerConfig = {
  realtimeManager: SupabaseRealtimeManager;
  handlers: DatabaseChangeHandler[];
  userId: string;
  onConnected?: () => void;
  onError?: (error: unknown) => void;
};

export class RealtimeHandler {
  private channelTopic: string;
  private started = false;

  constructor(private readonly config: RealtimeHandlerConfig) {
    this.channelTopic = `wallet:${config.userId}`;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;

    const channelBuilder = this.config.realtimeManager
      .channel(this.channelTopic, { private: true })
      .on('broadcast', { event: '*' }, ({ event, payload }) => {
        const handler = this.config.handlers.find((h) => h.event === event);
        if (!handler) {
          return;
        }

        try {
          const result = handler.handleEvent(payload);
          if (result instanceof Promise) {
            result.catch((error) => {
              this.config.onError?.(error);
            });
          }
        } catch (error) {
          this.config.onError?.(error);
        }
      });

    this.config.realtimeManager.addChannel(channelBuilder);
    await this.config.realtimeManager.subscribe(
      this.channelTopic,
      this.config.onConnected,
    );
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.started = false;
    await this.config.realtimeManager.removeChannel(this.channelTopic, {
      onConnected: this.config.onConnected,
    });
  }
}
```

- [ ] Verify: `bun run typecheck`
- [ ] Commit: `feat(sdk): add RealtimeHandler class`

---

## Task 8: Wire into WalletClient

**Files:**
- Modify: `packages/sdk/src/core/wallet-client.ts`

- [ ] Add imports for all change handler factories + RealtimeHandler:

```typescript
import { createAccountChangeHandlers } from '../features/accounts/account-change-handlers';
import { createCashuReceiveQuoteChangeHandlers, createCashuReceiveSwapChangeHandlers } from '../features/receive/cashu-receive-change-handlers';
import { createSparkReceiveQuoteChangeHandlers } from '../features/receive/spark-receive-change-handlers';
import { createCashuSendQuoteChangeHandlers, createCashuSendSwapChangeHandlers } from '../features/send/cashu-send-change-handlers';
import { createSparkSendQuoteChangeHandlers } from '../features/send/spark-send-change-handlers';
import { createTransactionChangeHandlers } from '../features/transactions/transaction-change-handlers';
import type { DatabaseChangeHandler } from '../features/wallet/database-change-handler';
import { RealtimeHandler } from '../features/wallet/realtime-handler';
import type { SupabaseRealtimeManager } from '../lib/supabase/supabase-realtime-manager';
```

- [ ] Add to `WalletClient` type:

```typescript
  changeHandlers: DatabaseChangeHandler[];
  createRealtimeHandler(realtimeManager: SupabaseRealtimeManager): RealtimeHandler;
```

- [ ] Add to `createWalletClient()` factory, after `taskProcessors`:

```typescript
  const changeHandlers: DatabaseChangeHandler[] = [
    ...createAccountChangeHandlers(repos.accountRepo, caches.accounts),
    ...createTransactionChangeHandlers(repos.transactionRepo, caches.transactions),
    ...createCashuReceiveQuoteChangeHandlers(
      repos.cashuReceiveQuoteRepo,
      caches.cashuReceiveQuote,
      caches.pendingCashuReceiveQuotes,
    ),
    ...createCashuReceiveSwapChangeHandlers(
      repos.cashuReceiveSwapRepo,
      caches.pendingCashuReceiveSwaps,
    ),
    ...createCashuSendQuoteChangeHandlers(
      repos.cashuSendQuoteRepo,
      caches.unresolvedCashuSendQuotes,
    ),
    ...createCashuSendSwapChangeHandlers(
      repos.cashuSendSwapRepo,
      caches.cashuSendSwap,
      caches.unresolvedCashuSendSwaps,
    ),
    ...createSparkReceiveQuoteChangeHandlers(
      repos.sparkReceiveQuoteRepo,
      caches.sparkReceiveQuote,
      caches.pendingSparkReceiveQuotes,
    ),
    ...createSparkSendQuoteChangeHandlers(
      repos.sparkSendQuoteRepo,
      caches.unresolvedSparkSendQuotes,
    ),
  ];
```

- [ ] Add `createRealtimeHandler` factory method and return both in the wallet object:

```typescript
  const createRealtimeHandler = (
    realtimeManager: SupabaseRealtimeManager,
  ): RealtimeHandler =>
    new RealtimeHandler({
      realtimeManager,
      handlers: changeHandlers,
      userId,
      onConnected: () => {
        caches.accounts.invalidate();
        caches.transactions.invalidate();
        caches.cashuReceiveQuote.invalidate();
        caches.pendingCashuReceiveQuotes.invalidate();
        caches.pendingCashuReceiveSwaps.invalidate();
        caches.unresolvedCashuSendQuotes.invalidate();
        caches.cashuSendSwap.invalidate();
        caches.unresolvedCashuSendSwaps.invalidate();
        caches.sparkReceiveQuote.invalidate();
        caches.pendingSparkReceiveQuotes.invalidate();
        caches.unresolvedSparkSendQuotes.invalidate();
      },
    });

  return {
    caches,
    changeHandlers,
    cleanup: ...,
    createRealtimeHandler,
    // ... rest unchanged
  };
```

- [ ] Verify: `bun run typecheck`
- [ ] Commit: `feat(sdk): wire change handlers + RealtimeHandler into WalletClient`

---

## Task 9: Update SDK exports

**Files:**
- Modify: `packages/sdk/src/index.ts`

- [ ] Add exports:

```typescript
// Realtime
export type { DatabaseChangeHandler } from './features/wallet/database-change-handler';
export { RealtimeHandler } from './features/wallet/realtime-handler';
export type { RealtimeHandlerConfig } from './features/wallet/realtime-handler';

// Change handler factories
export { createAccountChangeHandlers } from './features/accounts/account-change-handlers';
export {
  createCashuReceiveQuoteChangeHandlers,
  createCashuReceiveSwapChangeHandlers,
} from './features/receive/cashu-receive-change-handlers';
export {
  createCashuSendQuoteChangeHandlers,
  createCashuSendSwapChangeHandlers,
} from './features/send/cashu-send-change-handlers';
export { createSparkReceiveQuoteChangeHandlers } from './features/receive/spark-receive-change-handlers';
export { createSparkSendQuoteChangeHandlers } from './features/send/spark-send-change-handlers';
export { createTransactionChangeHandlers } from './features/transactions/transaction-change-handlers';
```

- [ ] Verify: `bun run typecheck`
- [ ] Commit: `feat(sdk): export realtime types and change handler factories`

---

## Task 10: Thin out web app hooks

**Files:**
- Modify: `app/features/wallet/use-track-wallet-changes.ts`
- Modify: 8 hook files (remove `useXxxChangeHandlers` functions)

- [ ] Update `use-track-wallet-changes.ts` to use `wallet.changeHandlers`:

```typescript
// Replace 8 useXxxChangeHandlers hook calls with wallet.changeHandlers
import { useContactChangeHandlers, useContactsCache } from '../contacts/contact-hooks';
import { useUser } from '../user/user-hooks';
import { useWalletClient } from '../wallet/wallet-client';

export const useTrackWalletChanges = () => {
  const wallet = useWalletClient();
  const contactChangeHandlers = useContactChangeHandlers();
  const contactsCache = useContactsCache();

  useTrackDatabaseChanges({
    handlers: [...wallet.changeHandlers, ...contactChangeHandlers],
    onConnected: () => {
      // The web app does not use RealtimeHandler — it manages its own channel
      // via useSupabaseRealtime. These invalidations are needed here because
      // onConnected fires when the web app's channel reconnects.
      wallet.caches.accounts.invalidate();
      wallet.caches.transactions.invalidate();
      wallet.caches.cashuReceiveQuote.invalidate();
      wallet.caches.pendingCashuReceiveQuotes.invalidate();
      wallet.caches.pendingCashuReceiveSwaps.invalidate();
      wallet.caches.unresolvedCashuSendQuotes.invalidate();
      wallet.caches.cashuSendSwap.invalidate();
      wallet.caches.unresolvedCashuSendSwaps.invalidate();
      wallet.caches.sparkReceiveQuote.invalidate();
      wallet.caches.pendingSparkReceiveQuotes.invalidate();
      wallet.caches.unresolvedSparkSendQuotes.invalidate();
      contactsCache.invalidate();
    },
  });
};
```

- [ ] Remove `useAccountChangeHandlers` from `app/features/accounts/account-hooks.ts` (and its cache hook imports that are no longer needed)
- [ ] Remove `useTransactionChangeHandlers` from `app/features/transactions/transaction-hooks.ts`
- [ ] Remove `useCashuReceiveQuoteChangeHandlers` from `app/features/receive/cashu-receive-quote-hooks.ts`
- [ ] Remove `useCashuReceiveSwapChangeHandlers` from `app/features/receive/cashu-receive-swap-hooks.ts`
- [ ] Remove `useCashuSendQuoteChangeHandlers` from `app/features/send/cashu-send-quote-hooks.ts`
- [ ] Remove `useCashuSendSwapChangeHandlers` from `app/features/send/cashu-send-swap-hooks.ts`
- [ ] Remove `useSparkReceiveQuoteChangeHandlers` from `app/features/receive/spark-receive-quote-hooks.ts`
- [ ] Remove `useSparkSendQuoteChangeHandlers` from `app/features/send/spark-send-quote-hooks.ts`
- [ ] Verify: `bun run fix:all`
- [ ] Commit: `refactor(app): use SDK change handlers in useTrackWalletChanges`

---

## Task 11: Final verification

- [ ] Run: `bun run fix:all` — must pass with zero errors
- [ ] Run: `bun test` — all tests pass
- [ ] Verify `use-track-wallet-changes.ts` no longer imports from any feature hook file except contacts
- [ ] Verify no `useXxxChangeHandlers` functions remain in the 8 modified hook files (grep: `grep -r "ChangeHandlers" app/features/ --include="*.ts"` — should only show contacts + the `useTrackWalletChanges` import)
