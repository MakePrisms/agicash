/**
 * The `Sdk` class — §1 of the contract.
 *
 * S8: `auth` + `user` + `accounts` + `scan` + `exchangeRate` + `cashu` + `spark`
 * + `transactions` + `contacts` + `transfers` are real (`cashu.send.executeQuote`
 * and `cashu.receive.receiveToken` and `spark.send.executeQuote` are S7 stubs);
 * only `background` is stubbed (`NotImplementedError`) until its slice lands.
 */
import type { SdkConfig } from './config';
import type {
  AccountsDomain,
  AuthDomain,
  BackgroundDomain,
  CashuDomain,
  ContactsDomain,
  ExchangeRateDomain,
  ScanDomain,
  SparkDomain,
  TransactionsDomain,
  TransfersDomain,
  UserDomain,
} from './domains';
import { createAccountsDomain } from './domains/accounts/accounts-domain';
import { createAuthDomain } from './domains/auth/auth-domain';
import { createCashuDomain } from './domains/cashu/cashu-domain';
import { createContactsDomain } from './domains/contacts/contacts-domain';
import type { DomainContext } from './domains/context';
import { createExchangeRateDomain } from './domains/exchange-rate/exchange-rate-domain';
import { createScanDomain } from './domains/scan/scan-domain';
import { createSparkDomain } from './domains/spark/spark-domain';
import {
  buildTransferService,
  createTransfersDomain,
} from './domains/transfers/transfers-domain';
import { createTransactionsDomain } from './domains/transactions/transactions-domain';
import { createUserDomain } from './domains/user/user-domain';
import type { EventEmitter, SdkEventMap } from './events';
import { type SdkConnections, buildConnections } from './internal/connections';
import { SdkEventEmitter } from './internal/event-emitter';
import { notImplementedDomain } from './internal/not-implemented';
import { AccountRepository } from './internal/repositories/account-repository';
import { ContactRepository } from './internal/repositories/contact-repository';
import { TransactionRepository } from './internal/repositories/transaction-repository';

/**
 * The Agicash wallet SDK. Construct with {@link Sdk.create}; reach functionality
 * through the domain accessors; subscribe via {@link Sdk.events}; tear down with
 * {@link Sdk.destroy}. Framework-free, no general domain cache.
 *
 * S8: `auth`, `user`, `accounts`, `scan`, `exchangeRate`, `cashu`, `spark`,
 * `transactions`, `contacts`, `transfers` are implemented (`cashu.send.executeQuote`
 * + `cashu.receive.receiveToken` + `spark.send.executeQuote` are S7 stubs);
 * only `background` is stubbed (`NotImplementedError`) until its slice lands.
 */
export class Sdk {
  readonly auth: AuthDomain;
  readonly user: UserDomain;
  readonly accounts: AccountsDomain;
  readonly cashu: CashuDomain;
  readonly spark: SparkDomain;
  readonly transactions: TransactionsDomain;
  readonly contacts: ContactsDomain;
  readonly transfers: TransfersDomain;
  readonly scan: ScanDomain;
  readonly exchangeRate: ExchangeRateDomain;
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
    const accountRepository = new AccountRepository(
      connections.supabase,
      connections.encryption,
      connections.cashuWallets,
      connections.sparkWallets,
      connections.mintAuth,
      connections.getCashuSeed,
    );
    this.accounts = createAccountsDomain(ctx, accountRepository);
    this.scan = createScanDomain(ctx);
    this.exchangeRate = createExchangeRateDomain();
    this.cashu = createCashuDomain(ctx, accountRepository);
    this.spark = createSparkDomain(ctx);
    this.transactions = createTransactionsDomain(
      ctx,
      new TransactionRepository(connections.supabase, connections.encryption),
    );
    this.contacts = createContactsDomain(
      ctx,
      new ContactRepository(connections.supabase, config.lud16Domain),
    );
    this.transfers = createTransfersDomain(
      ctx,
      buildTransferService(ctx, accountRepository),
    );
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
