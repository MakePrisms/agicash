/**
 * The `Sdk` class — §1 of the contract.
 *
 * S9: all 11 domains are live and fully implemented — `auth` + `user` +
 * `accounts` + `scan` + `exchangeRate` + `cashu` + `spark` + `transactions` +
 * `contacts` + `transfers` + `background`. The previously-dark
 * `cashu.send.executeQuote`, `cashu.receive.receiveToken`, and
 * `spark.send.executeQuote` are now wired (background drives completion).
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
import { createBackgroundDomain } from './domains/background/background-domain';
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
import { AccountRepository } from './internal/repositories/account-repository';
import { ContactRepository } from './internal/repositories/contact-repository';
import { TransactionRepository } from './internal/repositories/transaction-repository';

/**
 * The Agicash wallet SDK. Construct with {@link Sdk.create}; reach functionality
 * through the domain accessors; subscribe via {@link Sdk.events}; tear down with
 * {@link Sdk.destroy}. Framework-free, no general domain cache.
 *
 * S9: all 11 domains live and fully implemented — `auth`, `user`, `accounts`,
 * `scan`, `exchangeRate`, `cashu`, `spark`, `transactions`, `contacts`,
 * `transfers`, `background`. `cashu.send.executeQuote`,
 * `cashu.receive.receiveToken`, and `spark.send.executeQuote` are wired
 * (foreground kick; the background loop drives completion).
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
  readonly background: BackgroundDomain;

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
    this.spark = createSparkDomain(ctx, accountRepository);
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
    this.background = createBackgroundDomain(ctx, accountRepository);
  }

  /** Construct the SDK from `config`, wiring the full connection bundle. */
  static async create(config: SdkConfig): Promise<Sdk> {
    const connections = buildConnections(config);
    return new Sdk(config, connections);
  }

  /** Stop the background loop, tear down realtime channels, and clear event handlers. */
  async destroy(): Promise<void> {
    // Idempotent when never started (stop() short-circuits on 'stopped'); when
    // running it clears the poll interval, balance listeners, and forwarder so
    // destroy() cannot leak a timer.
    await this.background.stop();
    await this.connections.supabase.removeAllChannels();
    this.emitter.removeAll();
  }
}
