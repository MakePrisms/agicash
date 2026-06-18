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

type TransactionRow =
  Database['wallet']['Functions']['list_transactions']['Returns'][number];

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
          console.error('wallet changes forwarder failed', {
            event,
            cause: error,
          }),
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
        const transaction = await this.deps.transactionRepository.toTransaction(
          payload as TransactionRow,
        );
        this.deps.emitter.emit('transaction:created', { transaction });
        return;
      }
      case 'TRANSACTION_UPDATED': {
        const transaction = await this.deps.transactionRepository.toTransaction(
          payload as TransactionRow,
        );
        this.deps.emitter.emit('transaction:updated', { transaction });
        return;
      }
      case 'ACCOUNT_CREATED': {
        const account = await this.deps.accountRepository.toAccount(
          payload as AgicashDbAccountWithProofs,
        );
        this.deps.emitter.emit('account:updated', { account, op: 'created' });
        return;
      }
      case 'ACCOUNT_UPDATED': {
        const account = await this.deps.accountRepository.toAccount(
          payload as AgicashDbAccountWithProofs,
        );
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
