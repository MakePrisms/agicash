import type {
  Cursor,
  TransactionRepository,
} from '../internal/db/transaction-repository';
import type { Transaction } from './transaction';

type Deps = {
  transactionRepository: TransactionRepository;
  /** Resolves the current user's id, or null when signed out. */
  getCurrentUserId: () => Promise<string | null>;
};

/**
 * The `transactions` domain: cursor-paginated history, single lookup, and the
 * unacknowledged-count + acknowledge mutation. Promise-based in both variants
 * (there is no transaction store), so the full surface lives here.
 */
export class TransactionsDomain {
  constructor(private readonly deps: Deps) {}

  /** A page of the user's transaction history. Pass `nextCursor` back to paginate. */
  async list(params?: {
    accountId?: string;
    cursor?: Cursor;
    pageSize?: number;
    abortSignal?: AbortSignal;
  }): Promise<{ transactions: Transaction[]; nextCursor: Cursor }> {
    const userId = await this.requireUserId();
    return this.deps.transactionRepository.list({
      userId,
      accountId: params?.accountId,
      cursor: params?.cursor,
      pageSize: params?.pageSize,
      abortSignal: params?.abortSignal,
    });
  }

  /** A single transaction by id. Null if not found. */
  get(transactionId: string): Promise<Transaction | null> {
    return this.deps.transactionRepository.get(transactionId);
  }

  /** Count of the user's transactions pending acknowledgement. */
  async countPendingAck(): Promise<number> {
    const userId = await this.requireUserId();
    return this.deps.transactionRepository.countTransactionsPendingAck({
      userId,
    });
  }

  /** Marks a transaction as acknowledged. */
  async acknowledge(transactionId: string): Promise<void> {
    const userId = await this.requireUserId();
    return this.deps.transactionRepository.acknowledgeTransaction({
      userId,
      transactionId,
    });
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
