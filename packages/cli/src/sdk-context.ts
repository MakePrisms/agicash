import { fetchUser, isConfigured } from '@agicash/opensecret-sdk';
import {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  type Cache,
  type WalletClient,
  WriteUserRepository,
  createWalletClient,
  getCashuCryptography,
  getSeedPhraseDerivationPath,
  getSparkIdentityPublicKeyFromMnemonic,
} from '@agicash/sdk';
import { getMintAuthProvider } from './opensecret-auth-provider';
import { createOpenSecretKeyProvider } from './opensecret-key-provider';
import { CONFIG_LOCATION_HINT } from './runtime-config';
import { getSupabaseClient } from './supabase-client';

function queryClientAsCache(queryClient: WalletClient['queryClient']): Cache {
  return {
    fetchQuery: (options) => queryClient.fetchQuery(options),
    cancelQueries: (params) => queryClient.cancelQueries(params),
    invalidateQueries: (params) => queryClient.invalidateQueries(params),
    setQueryData: (queryKey, data) => {
      queryClient.setQueryData(queryKey, data);
    },
  };
}

export type SdkContext = {
  userId: string;
  wallet: WalletClient;
  accountService: WalletClient['services']['accountService'];
  cashuReceiveQuoteService: WalletClient['services']['cashuReceiveQuoteService'];
  cashuReceiveSwapService: WalletClient['services']['cashuReceiveSwapService'];
  cashuSendQuoteService: WalletClient['services']['cashuSendQuoteService'];
  cashuSendSwapService: WalletClient['services']['cashuSendSwapService'];
  accountRepo: WalletClient['repos']['accountRepo'];
  cashuReceiveQuoteRepo: WalletClient['repos']['cashuReceiveQuoteRepo'];
  cashuSendSwapRepo: WalletClient['repos']['cashuSendSwapRepo'];
  transactionRepo: WalletClient['repos']['transactionRepo'];
  cache: Cache;
  cleanup(): Promise<void>;
};

let cached: SdkContext | null = null;

export async function getSdkContext(): Promise<SdkContext> {
  if (cached) return cached;

  if (!isConfigured()) {
    throw new Error(
      `OpenSecret is not configured. Set OPENSECRET_CLIENT_ID in ${CONFIG_LOCATION_HINT}.`,
    );
  }

  const { user } = await fetchUser();
  const userId = user.id;
  const db = getSupabaseClient();
  const keyProvider = createOpenSecretKeyProvider();
  const wallet = createWalletClient({
    db,
    keyProvider,
    userId,
    getMintAuthProvider,
  });
  const cache = queryClientAsCache(wallet.queryClient);
  const cashuCrypto = getCashuCryptography(keyProvider, cache);

  const sparkSeedPath = getSeedPhraseDerivationPath('spark', 12);
  const [{ public_key }, cashuLockingXpub, sparkMnemonic] = await Promise.all([
    keyProvider.getPublicKey('schnorr', {
      private_key_derivation_path: "m/10111099'/0'",
    }),
    cashuCrypto.getXpub(BASE_CASHU_LOCKING_DERIVATION_PATH),
    keyProvider
      .getMnemonic({
        seed_phrase_derivation_path: sparkSeedPath,
      })
      .then(({ mnemonic }) => mnemonic),
  ]);

  const sparkIdentityPublicKey = await getSparkIdentityPublicKeyFromMnemonic(
    sparkMnemonic,
    'MAINNET',
  );
  const writeUserRepo = new WriteUserRepository(db, wallet.repos.accountRepo);
  await writeUserRepo.upsert({
    id: userId,
    email: user.email ?? undefined,
    emailVerified: user.email_verified,
    accounts: [
      {
        type: 'spark',
        currency: 'BTC',
        name: 'Bitcoin',
        network: 'MAINNET',
        isDefault: true,
        purpose: 'transactional',
      },
    ],
    cashuLockingXpub,
    encryptionPublicKey: public_key,
    sparkIdentityPublicKey,
  });

  cached = {
    userId,
    wallet,
    accountService: wallet.services.accountService,
    cashuReceiveQuoteService: wallet.services.cashuReceiveQuoteService,
    cashuReceiveSwapService: wallet.services.cashuReceiveSwapService,
    cashuSendQuoteService: wallet.services.cashuSendQuoteService,
    cashuSendSwapService: wallet.services.cashuSendSwapService,
    accountRepo: wallet.repos.accountRepo,
    cashuReceiveQuoteRepo: wallet.repos.cashuReceiveQuoteRepo,
    cashuSendSwapRepo: wallet.repos.cashuSendSwapRepo,
    transactionRepo: wallet.repos.transactionRepo,
    cache,
    async cleanup() {
      await wallet.cleanup();
    },
  };

  return cached;
}

export async function cleanupSdkContext(
  sdkContext: SdkContext | null | undefined = cached,
): Promise<void> {
  if (!sdkContext) {
    return;
  }

  try {
    await sdkContext.cleanup();
  } finally {
    if (cached === sdkContext) {
      cached = null;
    }
  }
}
