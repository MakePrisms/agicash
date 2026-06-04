/**
 * `TransactionsDomain` implementation — §7 of the contract, Slice 4 (reactive overlay, design B).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/transactions/transaction-hooks.ts` (`useTransactions` /
 * `useTransaction` / `useHasTransactionsPendingAck` / `useAcknowledgeTransaction`) +
 * `transaction-repository.ts`. Master expresses these as React hooks over a TanStack
 * `TransactionsCache` + an infinite query.
 *
 * REACTIVE OVERLAY: TanStack is no longer in the consumer — it is hidden inside the SDK.
 *  - `list(filter?)` / `get(id)` / `countPendingAck()` are OBSERVABLE FETCHES → each returns a
 *    `Query<T>`. The fetch BODY is the no-cache read (the repository DB read via the
 *    `list_transactions` RPC / a row lookup / a `pending` count, scoped to the resolved user),
 *    wrapped via {@link toQuery} over the SDK-internal `QueryClient` and MEMOISED per key (`#q`)
 *    so repeated calls with the same arguments return the SAME stable `Query` ref (matching the
 *    per-key-memo the other reactive domains use). `list` is memoised per
 *    `accountId`/`cursor`/`pageSize`; `get` per id. Realtime (Slice 5) writes the same client to
 *    push fresh values / invalidate these keys when a `transaction:*` change arrives.
 *  - `acknowledge(transaction)` is a WRITE → stays `Promise` (lifted verbatim).
 *
 * Two-mode API rule (Josip 6/01): `list`/`get`/`countPendingAck` are FETCHES; `acknowledge`
 * takes the FULL transaction object (user-invoked). Background-processor DB reads are Slice 5.
 *
 * @module
 */
import {
  DEFAULT_TRANSACTION_PAGE_SIZE,
  type TransactionRepository,
} from '../internal/transaction-repository';
import type { SessionResolver } from '../internal/session';
import type { TransactionsDomain } from '../domains';
import { type QueryClient, toQuery } from '../query';
import type { Query } from '../types/query';
import type { Transaction, TransactionCursor } from '../types/transaction';

/** Stable query-key prefix for the (paginated) transaction list. */
const TRANSACTIONS_KEY = 'transactions';
/** Stable query-key prefix for a single transaction by id. */
const TRANSACTION_KEY = 'transaction';
/** Stable query-key prefix for the pending-acknowledgment count. */
const TRANSACTIONS_PENDING_ACK_KEY = 'transactions:pendingAck';

/**
 * The transactions domain. Construct with the SDK-internal `QueryClient` (backs the observable
 * reads), the transaction repository (DB read/write), and the session resolver (current user id,
 * for the RLS-scoped user-id filter the RPCs/counts take).
 */
export class TransactionsDomainImpl implements TransactionsDomain {
  /**
   * Per-key memo of the `Query` handles this domain exposes, so repeated calls with the same
   * arguments return the SAME stable reference. Hidden inside the SDK.
   */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Query<T> memo, keyed by string
  readonly #q = new Map<string, Query<any>>();

  /**
   * @param client - the SDK-internal TanStack `QueryClient` (never exposed to consumers).
   * @param transactions - the `wallet.transactions` repository.
   * @param session - resolves the current user (id).
   */
  constructor(
    private readonly client: QueryClient,
    private readonly transactions: TransactionRepository,
    private readonly session: SessionResolver,
  ) {}

  /**
   * Memoise a `Query` per stringified key: the FIRST call for a key builds the `Query` via
   * {@link toQuery}; later calls return the same stable ref. Mirrors the per-key-memo the other
   * reactive domains use (e.g. `accounts.list`).
   */
  #memo<T>(key: readonly unknown[], fn: () => Promise<T>): Query<T> {
    const id = JSON.stringify(key);
    let q = this.#q.get(id);
    if (!q) {
      q = toQuery<T>(this.client, key, fn);
      this.#q.set(id, q);
    }
    return q;
  }

  /**
   * List transactions — as an observable {@link Query} of a state-sorted (PENDING first),
   * cursor-paginated page. Re-houses master `useTransactions`: the fetch body calls the
   * repository `list` (the `list_transactions` RPC) for the user, then CAPS paging exactly as
   * master does — `nextCursor` is non-null only when the page came back full (a short page means
   * there is no next page). `pageSize` defaults to master's 25. The reactive overlay wraps the
   * body in a {@link toQuery}-backed `Query`, memoised per `accountId`/`cursor`/`pageSize`.
   *
   * @param params - optional `{ accountId, cursor, pageSize }`.
   * @returns a stable `Query<{ transactions, nextCursor }>` (nextCursor null when exhausted).
   */
  list(params?: {
    accountId?: string;
    cursor?: TransactionCursor;
    pageSize?: number;
  }): Query<{
    transactions: Transaction[];
    nextCursor: TransactionCursor | null;
  }> {
    const pageSize = params?.pageSize ?? DEFAULT_TRANSACTION_PAGE_SIZE;
    const accountId = params?.accountId;
    const cursor = params?.cursor ?? null;

    return this.#memo(
      [TRANSACTIONS_KEY, accountId ?? null, cursor, pageSize],
      async () => {
        const user = await this.session.requireCurrentUser();
        const result = await this.transactions.list({
          userId: user.id,
          cursor,
          pageSize,
          accountId,
        });

        return {
          transactions: result.transactions,
          // Master caps paging: only advance the cursor when the page was full.
          nextCursor:
            result.transactions.length === pageSize ? result.nextCursor : null,
        };
      },
    );
  }

  /**
   * The transaction with this id, or `null` — as an observable {@link Query}. Re-houses master
   * `useTransaction`'s read (without the React `NotFoundError`-on-missing throw — the contract
   * returns null). Memoised per id.
   *
   * @param id - the transaction id.
   * @returns a stable `Query<Transaction | null>`.
   */
  get(id: string): Query<Transaction | null> {
    return this.#memo([TRANSACTION_KEY, id], () => this.transactions.get(id));
  }

  /**
   * The count of the user's transactions whose `acknowledgmentStatus` is `pending` — as an
   * observable {@link Query}. Re-houses master `useHasTransactionsPendingAck`'s
   * `countTransactionsPendingAck` (returning the count, not the `> 0` boolean the hook derives).
   *
   * @returns a stable `Query<number>`.
   */
  countPendingAck(): Query<number> {
    return this.#memo([TRANSACTIONS_PENDING_ACK_KEY], async () => {
      const user = await this.session.requireCurrentUser();
      return this.transactions.countTransactionsPendingAck({ userId: user.id });
    });
  }

  /**
   * Mark `transaction` as acknowledged (FULL object). Re-houses master
   * `useAcknowledgeTransaction`'s mutation (sans the cache writes — the consumer updates its own
   * read-model from the resulting `transaction:updated` event). An ACTION → `Promise`.
   *
   * @param transaction - the transaction to acknowledge.
   */
  async acknowledge(transaction: Transaction): Promise<void> {
    const user = await this.session.requireCurrentUser();
    await this.transactions.acknowledgeTransaction({
      userId: user.id,
      transactionId: transaction.id,
    });
  }
}
