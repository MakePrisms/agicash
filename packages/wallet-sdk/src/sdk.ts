/**
 * The `Sdk` class SHAPE — §1 of the contract. DECLARATION ONLY (no impl).
 *
 * PR1 ships the public shape via `declare class` (no method bodies / no wiring).
 * The real `Sdk.create` shell + domain-accessor wiring + connection setup land in
 * the core implementation PR (Slice 0 / PR2).
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
import type { EventEmitter, SdkEventMap } from './events';

export declare class Sdk {
  static create(config: SdkConfig): Promise<Sdk>;
  readonly auth: AuthDomain;
  readonly user: UserDomain;
  readonly accounts: AccountsDomain;
  /** .send + .receive */
  readonly cashu: CashuDomain;
  /** .send + .receive */
  readonly spark: SparkDomain;
  readonly transactions: TransactionsDomain;
  readonly contacts: ContactsDomain;
  readonly transfers: TransfersDomain;
  readonly scan: ScanDomain;
  readonly exchangeRate: ExchangeRateDomain;
  readonly background: BackgroundDomain;
  readonly events: EventEmitter<SdkEventMap>;
  /** close WS subs (mints + Supabase + Breez), halt orchestrators, clear timers */
  destroy(): Promise<void>;
}
