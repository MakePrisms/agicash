/**
 * The `Sdk` class — §1 of the contract.
 *
 * S2 (core shell): events are real; the 11 domains are stubbed
 * (`NotImplementedError`) until their slices implement them. The connection
 * bundle is wired in a later task of this slice.
 */
import type { SdkConfig } from './config';
import type {
  AccountsDomain,
  AuthDomain,
  BackgroundDomain,
  CashuDomain,
  CashuReceiveOps,
  CashuSendOps,
  ContactsDomain,
  ExchangeRateDomain,
  ScanDomain,
  SparkDomain,
  SparkReceiveOps,
  SparkSendOps,
  TransactionsDomain,
  TransfersDomain,
  UserDomain,
} from './domains';
import type { EventEmitter, SdkEventMap } from './events';
import { SdkEventEmitter } from './internal/event-emitter';
import { notImplementedDomain } from './internal/not-implemented';

/**
 * The Agicash wallet SDK. Construct with {@link Sdk.create}; reach functionality
 * through the domain accessors; subscribe via {@link Sdk.events}; tear down with
 * {@link Sdk.destroy}. Framework-free, no general domain cache.
 *
 * S2 (core shell): events are real; the 11 domains are stubbed
 * (`NotImplementedError`) until their slices implement them. The connection
 * bundle is wired in a later task of this slice.
 */
export class Sdk {
  readonly auth: AuthDomain = notImplementedDomain<AuthDomain>('auth');
  readonly user: UserDomain = notImplementedDomain<UserDomain>('user');
  readonly accounts: AccountsDomain =
    notImplementedDomain<AccountsDomain>('accounts');
  readonly cashu: CashuDomain = {
    send: notImplementedDomain<CashuSendOps>('cashu.send'),
    receive: notImplementedDomain<CashuReceiveOps>('cashu.receive'),
  };
  readonly spark: SparkDomain = {
    send: notImplementedDomain<SparkSendOps>('spark.send'),
    receive: notImplementedDomain<SparkReceiveOps>('spark.receive'),
  };
  readonly transactions: TransactionsDomain =
    notImplementedDomain<TransactionsDomain>('transactions');
  readonly contacts: ContactsDomain =
    notImplementedDomain<ContactsDomain>('contacts');
  readonly transfers: TransfersDomain =
    notImplementedDomain<TransfersDomain>('transfers');
  readonly scan: ScanDomain = notImplementedDomain<ScanDomain>('scan');
  readonly exchangeRate: ExchangeRateDomain =
    notImplementedDomain<ExchangeRateDomain>('exchangeRate');
  readonly background: BackgroundDomain =
    notImplementedDomain<BackgroundDomain>('background');

  private readonly emitter = new SdkEventEmitter<SdkEventMap>();
  readonly events: EventEmitter<SdkEventMap> = this.emitter;

  protected constructor(protected readonly config: SdkConfig) {}

  /**
   * Construct the SDK from `config`. S2: stores config + wires events; the
   * connection bundle is attached in a later task (still domains-stubbed).
   */
  static async create(config: SdkConfig): Promise<Sdk> {
    return new Sdk(config);
  }

  /** Tear down: clear event handlers (connection teardown added later). */
  async destroy(): Promise<void> {
    this.emitter.removeAll();
  }
}
