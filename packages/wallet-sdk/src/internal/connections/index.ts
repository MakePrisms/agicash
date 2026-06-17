import { Mint } from '@cashu/cashu-ts';
import { mnemonicToSeedSync } from '@scure/bip39';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SdkConfig } from '../../config';
import type { SparkNetwork } from '../../types/dependencies';
import { EncryptionService } from '../crypto/encryption';
import { CASHU_MNEMONIC_PATH, SPARK_MNEMONIC_PATH, type KeyProvider } from '../crypto/keys';
import type { Database } from '../db/database';
import { ExtendedMintInfo } from '../lib/cashu';
import { SupabaseRealtimeManager } from '../realtime/supabase-realtime-manager';
import { buildMintValidator } from '../lib/cashu/mint-validation';
import { connectBreez } from './breez';
import { getCashuCryptography, type CashuCryptography } from './cashu-crypto';
import { CashuWalletService, type MintMetadata } from './cashu-wallet';
import { MintAuthTokenProvider } from './mint-auth';
import {
  configureOpenSecret,
  generateThirdPartyToken,
  isLoggedIn,
  openSecretKeyProvider,
} from './open-secret';
import { SparkWalletService } from './spark-wallet';
import { createBrowserClient } from './supabase-client';
import { SupabaseSessionTokenProvider } from './supabase-session';

/** The external clients the SDK owns, assembled once per instance. */
export type SdkConnections = {
  supabase: SupabaseClient<Database>;
  session: SupabaseSessionTokenProvider;
  realtime: SupabaseRealtimeManager;
  keys: KeyProvider;
  encryption: EncryptionService;
  cashuWallets: CashuWalletService;
  sparkWallets: SparkWalletService;
  mintAuth: MintAuthTokenProvider;
  /** Cashu BIP39 seed (memoized) for wallet init; derived from the cashu child mnemonic. */
  getCashuSeed: () => Promise<Uint8Array>;
  cashuCrypto: CashuCryptography;
  cashuMintValidator: ReturnType<typeof buildMintValidator>;
};

/**
 * Configure OpenSecret + build the client-mode connection bundle from config.
 * Wallet services (cashu/spark) are constructed here but connect lazily —
 * no network calls at build time. The session provider bridges the OpenSecret
 * JWT to Supabase's `accessToken`, gated on `isLoggedIn`.
 */
export function buildConnections(config: SdkConfig): SdkConnections {
  configureOpenSecret(config);
  const session = new SupabaseSessionTokenProvider(
    async () => (await generateThirdPartyToken()).token,
    () => isLoggedIn(config.storage),
  );
  const supabase = createBrowserClient(config, session.getToken);
  const realtime = new SupabaseRealtimeManager(supabase.realtime);
  const keys = openSecretKeyProvider();

  const encryption = new EncryptionService(keys);

  let cashuSeed: Promise<Uint8Array> | null = null;
  const getCashuSeed = () => {
    cashuSeed ??= keys
      .getChildMnemonic(CASHU_MNEMONIC_PATH)
      .then((mnemonic) => mnemonicToSeedSync(mnemonic));
    return cashuSeed;
  };

  const cashuCrypto = getCashuCryptography(getCashuSeed);
  const cashuMintValidator = buildMintValidator({
    requiredNuts: [4, 5, 7, 8, 9, 10, 11, 12, 17, 20] as const,
    requiredWebSocketCommands: ['bolt11_melt_quote', 'proof_state'] as const,
    blocklist: config.cashuMintBlocklist ?? [],
  });

  const cashuWallets = new CashuWalletService(async (mintUrl) => {
    const mint = new Mint(mintUrl);
    const [info, keysets, mintKeys] = await Promise.all([
      mint.getInfo(),
      mint.getKeySets(),
      mint.getKeys(),
    ]);
    return {
      mintInfo: new ExtendedMintInfo(info),
      keysets,
      keys: mintKeys,
    } satisfies MintMetadata;
  });

  const sparkWallets = new SparkWalletService(async (network: SparkNetwork) => {
    const mnemonic = await keys.getChildMnemonic(SPARK_MNEMONIC_PATH);
    return connectBreez(
      {
        apiKey: config.breezApiKey ?? '',
        network: network.toLowerCase() as 'mainnet' | 'regtest',
        storageDir: config.sparkStorageDir ?? './.spark-data',
        debugLogging: config.debugLoggingSpark ?? false,
      },
      mnemonic,
    );
  });

  const mintAuth = new MintAuthTokenProvider(
    async () => (await generateThirdPartyToken('agicash-mint')).token,
    () => isLoggedIn(config.storage),
  );

  return {
    supabase,
    session,
    realtime,
    keys,
    encryption,
    cashuWallets,
    sparkWallets,
    mintAuth,
    getCashuSeed,
    cashuCrypto,
    cashuMintValidator,
  };
}
