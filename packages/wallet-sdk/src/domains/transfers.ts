import type { Money } from '@agicash/money';
import type {
  TransferQuote,
  TransferService,
} from '../internal/services/transfer-service';
import type { Account } from './account-types';

type Deps = {
  transferService: TransferService;
  /** Resolves the current user's id, or null when signed out. */
  getCurrentUserId: () => Promise<string | null>;
};

/**
 * The `transfers` domain: moving funds between the user's own accounts over
 * Lightning. `createQuote` fetches both Lightning quotes without persisting;
 * `execute` persists the receive + send quotes and the background processors
 * carry the send to completion.
 */
export class TransfersDomain {
  constructor(private readonly deps: Deps) {}

  /** A transfer quote (Lightning quotes for both sides; nothing persisted). */
  createQuote(params: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }): Promise<TransferQuote> {
    return this.deps.transferService.getTransferQuote(params);
  }

  /** Persists the transfer's receive + send quotes; processors do the rest. */
  async execute(quote: TransferQuote): Promise<{
    transferId: string;
    receiveTransactionId: string;
    sendTransactionId: string;
  }> {
    const userId = await this.requireUserId();
    return this.deps.transferService.initiateTransfer({ userId, quote });
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
