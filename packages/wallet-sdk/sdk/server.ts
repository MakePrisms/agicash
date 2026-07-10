import type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from '@agicash/lnurl';
import type { Money } from '@agicash/money';
import type { SparkNetwork } from '../db/json-models/spark-account-details-db-data';

/**
 * Server-side trust model: service-role key, no user session, per-request
 * scope. No `auth`, no `events`, no `background`.
 */
export type ServerSdkConfig = {
  db: { url: string; serviceRoleKey: string };
  spark: {
    breezApiKey: string;
    network: SparkNetwork;
    mnemonic: string;
    storageDir: string;
  };
  /** Hex; encrypts LNURL verify payloads. */
  quoteEncryptionKey: string;
};

export type ServerSdk = {
  readonly lightningAddress: {
    handleLud16Request(params: {
      username: string;
      baseUrl: string;
    }): Promise<LNURLPayParams | LNURLError>;
    handleLnurlpCallback(params: {
      userId: string;
      amount: Money<'BTC'>;
      baseUrl: string;
      /** Per-request by design — instance state would race on the per-process singleton. */
      bypassAmountValidation?: boolean;
    }): Promise<LNURLPayResult | LNURLError>;
    handleLnurlpVerify(params: {
      encryptedQuoteData: string;
    }): Promise<LNURLVerifyResult | LNURLError>;
  };
};

/** Singleton per process. */
export type ServerSdkConstructor = {
  create(config: ServerSdkConfig): ServerSdk;
};
