/**
 * The `Sdk` class — §1 of the contract.
 *
 * S3: `auth` + `user` are real (built from the connection bundle); the other 9
 * domains are stubbed (`NotImplementedError`) until their slices implement them.
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
import { createAuthDomain } from './domains/auth/auth-domain';
import type { DomainContext } from './domains/context';
import { createUserDomain } from './domains/user/user-domain';
import type { EventEmitter, SdkEventMap } from './events';
import { buildConnections, type SdkConnections } from './internal/connections';
import { SdkEventEmitter } from './internal/event-emitter';
import { notImplementedDomain } from './internal/not-implemented';

/**
 * The Agicash wallet SDK. Construct with {@link Sdk.create}; reach functionality
 * through the domain accessors; subscribe via {@link Sdk.events}; tear down with
 * {@link Sdk.destroy}. Framework-free, no general domain cache.
 *
 * S3: `auth` + `user` are implemented; the remaining domains are stubbed
 * (`NotImplementedError`) until their slices land.
 */
export class Sdk {
  readonly auth: AuthDomain;
  readonly user: UserDomain;
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

  private readonly emitter: SdkEventEmitter<SdkEventMap>;
  readonly events: EventEmitter<SdkEventMap>;

  protected constructor(
    protected readonly config: SdkConfig,
    protected readonly connections: SdkConnections,
  ) {
    this.emitter = new SdkEventEmitter<SdkEventMap>();
    this.events = this.emitter;
    const ctx: DomainContext = { config, connections, emitter: this.emitter };
    this.user = createUserDomain(ctx);
    this.auth = createAuthDomain(ctx);
  }

  /** Construct the SDK from `config`, wiring the full connection bundle. */
  static async create(config: SdkConfig): Promise<Sdk> {
    const connections = buildConnections(config);
    return new Sdk(config, connections);
  }

  /** Tear down realtime channels and clear event handlers. */
  async destroy(): Promise<void> {
    await this.connections.supabase.removeAllChannels();
    this.emitter.removeAll();
  }
}
