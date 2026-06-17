import { hexToBytes } from '@noble/hashes/utils';
import { AgicashMintAuthProvider } from './internal/cashu/mint-auth-provider';
import { MintDataCache } from './internal/cashu/mint-cache';
import { createAgicashDb } from './internal/db/client';
import { DefaultAccountRepository } from './internal/db/default-account-repository';
import { ReadUserRepository } from './internal/db/user-repository';
import { LightningAddressService } from './internal/lightning-address/lightning-address-service';
import { ExchangeRateService } from './internal/rates/exchange-rate-service';
import type { Ticker } from './internal/rates/providers/types';
import {
  type SparkMnemonicSource,
  SparkWalletManager,
} from './internal/spark/wallet-manager';

export type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from './internal/lightning-address/lnurl-types';

/** Configuration for the server-mode SDK (LN-address routes). All values are
 * supplied by the host — the SDK reads no environment itself. */
export type ServerSdkConfig = {
  supabase: {
    url: string;
    /** Service-role key — RLS-bypassed. There is no authenticated end user. */
    serviceRoleKey: string;
  };
  /** Breez API key for the server's own spark wallet. */
  breezApiKey: string;
  /** Writable dir for the Breez SDK's local state. Default './.spark-data'. */
  sparkStorageDir?: string;
  lightningAddress: {
    /** The LN-address server's own BIP39 mnemonic (its spark wallet). */
    serverSparkMnemonic: string;
    /** Hex-encoded symmetric key for the LUD-21 verify-token obfuscation. */
    verifyEncryptionKey: string;
  };
  /** Resolves an exchange rate (e.g. 'BTC-USD') for the bypassAmountValidation
   * conversion path. Required only if an agicash↔agicash payment can land on a
   * non-BTC default account. */
  getExchangeRate?: (ticker: string) => Promise<string>;
};

export type ServerSdk = {
  lightningAddress: LightningAddressService;
  dispose(): Promise<void>;
};

/**
 * Builds a server-mode SDK: a service-role Supabase client (RLS-bypassed) plus
 * the slim runtime the LN-address routes need (mint cache, a server spark wallet
 * seeded from the LN-server mnemonic, the server-safe default-account read, and
 * the create-only receive services). No Open Secret, auth, realtime, or
 * background processing. Pure construction — spark connect() is lazy.
 */
export async function createServerSdk(
  config: ServerSdkConfig,
): Promise<ServerSdk> {
  const db = createAgicashDb(
    {
      url: config.supabase.url,
      anonKey: '',
      serviceRoleKey: config.supabase.serviceRoleKey,
    },
    async () => null,
  );

  const mintCache = new MintDataCache();

  // Server mode is never "logged in": fetch() short-circuits before touching
  // Open Secret, so the throwing stub below is never reached. External LN-address
  // payments only target transactional BTC accounts (no NUT-21 Clear Auth), so no
  // CAT is ever required.
  const mintAuth = new AgicashMintAuthProvider(
    {
      generateThirdPartyToken: () => {
        throw new Error('Open Secret is unavailable in server mode');
      },
    },
    async () => false,
  );

  const mnemonicSource: SparkMnemonicSource = {
    getSparkMnemonic: () =>
      Promise.resolve(config.lightningAddress.serverSparkMnemonic),
  };
  const sparkWallets = new SparkWalletManager(
    mnemonicSource,
    config.breezApiKey,
    config.sparkStorageDir ?? './.spark-data',
  );

  const defaultAccountRepository = new DefaultAccountRepository(
    db,
    mintCache,
    mintAuth,
    sparkWallets,
  );
  const userRepository = new ReadUserRepository(db);

  const lightningAddress = new LightningAddressService({
    db,
    userRepository,
    defaultAccountRepository,
    sparkWallets,
    verifyEncryptionKey: hexToBytes(
      config.lightningAddress.verifyEncryptionKey,
    ),
    getExchangeRate:
      config.getExchangeRate ??
      ((ticker) => new ExchangeRateService().getRate(ticker as Ticker)),
  });

  return {
    lightningAddress,
    dispose: async () => {
      mintCache.clear();
      await sparkWallets.dispose();
    },
  };
}
