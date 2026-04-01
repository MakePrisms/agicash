import { fetchUser, isConfigured } from '@agicash/opensecret-sdk';
import { getSeedPhraseDerivationPath } from '@agicash/sdk/features/accounts/account-cryptography';
import { AccountRepository } from '@agicash/sdk/features/accounts/account-repository';
import { AccountService } from '@agicash/sdk/features/accounts/account-service';
import { CashuReceiveQuoteRepository } from '@agicash/sdk/features/receive/cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from '@agicash/sdk/features/receive/cashu-receive-quote-service';
import { CashuReceiveSwapRepository } from '@agicash/sdk/features/receive/cashu-receive-swap-repository';
import { CashuReceiveSwapService } from '@agicash/sdk/features/receive/cashu-receive-swap-service';
import { CashuSendQuoteRepository } from '@agicash/sdk/features/send/cashu-send-quote-repository';
import { CashuSendQuoteService } from '@agicash/sdk/features/send/cashu-send-quote-service';
import { CashuSendSwapRepository } from '@agicash/sdk/features/send/cashu-send-swap-repository';
import { CashuSendSwapService } from '@agicash/sdk/features/send/cashu-send-swap-service';
import {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  getCashuCryptography,
} from '@agicash/sdk/features/shared/cashu';
import { getEncryption } from '@agicash/sdk/features/shared/encryption';
import { TransactionRepository } from '@agicash/sdk/features/transactions/transaction-repository';
import { WriteUserRepository } from '@agicash/sdk/features/user/user-repository';
import type { Cache } from '@agicash/sdk/interfaces/cache';
import { getSparkIdentityPublicKeyFromMnemonic } from '@agicash/sdk/lib/spark/index';
// packages/cli/src/sdk-context.ts
import { hexToBytes } from '@noble/hashes/utils';
import { mnemonicToSeedSync } from '@scure/bip39';
import { getKeyProvider } from './key-provider';
import { getSupabaseClient } from './supabase-client';

export type SdkContext = {
  userId: string;
  // Services (business logic -- CLI calls these)
  accountService: AccountService;
  cashuReceiveQuoteService: CashuReceiveQuoteService;
  cashuReceiveSwapService: CashuReceiveSwapService;
  cashuSendQuoteService: CashuSendQuoteService;
  cashuSendSwapService: CashuSendSwapService;
  // Repos exposed for simple CRUD (balance, list)
  accountRepo: AccountRepository;
  cashuReceiveQuoteRepo: CashuReceiveQuoteRepository;
  cashuSendSwapRepo: CashuSendSwapRepository;
  transactionRepo: TransactionRepository;
  // Shared
  cache: Cache;
};

const cache: Cache = {
  fetchQuery: async ({ queryFn }) => queryFn(),
};

let cached: SdkContext | null = null;

export async function getSdkContext(): Promise<SdkContext> {
  if (cached) return cached;

  if (!isConfigured()) {
    throw new Error(
      'Not configured. Set OPENSECRET_CLIENT_ID and SUPABASE_URL in .env',
    );
  }

  const { user } = await fetchUser();
  const userId = user.id;
  const db = getSupabaseClient();
  const keyProvider = getKeyProvider();

  // Encryption
  const encryptionKeyPath = "m/10111099'/0'";
  const [{ private_key }, { public_key }] = await Promise.all([
    keyProvider.getPrivateKeyBytes({
      private_key_derivation_path: encryptionKeyPath,
    }),
    keyProvider.getPublicKey('schnorr', {
      private_key_derivation_path: encryptionKeyPath,
    }),
  ]);
  const encryption = getEncryption(hexToBytes(private_key), public_key);

  // CashuCryptography (needed by receive quote service)
  const cashuCrypto = getCashuCryptography(keyProvider, cache);

  // Seed/mnemonic factories for AccountRepository
  const cashuSeedPath = getSeedPhraseDerivationPath('cashu', 12);
  const getCashuWalletSeed = async () => {
    const { mnemonic } = await keyProvider.getMnemonic({
      seed_phrase_derivation_path: cashuSeedPath,
    });
    return mnemonicToSeedSync(mnemonic);
  };
  const sparkSeedPath = getSeedPhraseDerivationPath('spark', 12);
  const getSparkWalletMnemonic = async () => {
    const { mnemonic } = await keyProvider.getMnemonic({
      seed_phrase_derivation_path: sparkSeedPath,
    });
    return mnemonic;
  };

  // Repositories
  const accountRepo = new AccountRepository(
    db,
    encryption,
    cache,
    getCashuWalletSeed,
    getSparkWalletMnemonic,
  );
  const cashuReceiveQuoteRepo = new CashuReceiveQuoteRepository(
    db,
    encryption,
    accountRepo,
  );
  const cashuReceiveSwapRepo = new CashuReceiveSwapRepository(
    db,
    encryption,
    accountRepo,
  );
  const cashuSendQuoteRepo = new CashuSendQuoteRepository(db, encryption);
  const cashuSendSwapRepo = new CashuSendSwapRepository(db, encryption);
  const transactionRepo = new TransactionRepository(db, encryption);

  // Services
  const accountService = new AccountService(accountRepo);
  const cashuReceiveQuoteService = new CashuReceiveQuoteService(
    cashuCrypto,
    cashuReceiveQuoteRepo,
  );
  const cashuReceiveSwapService = new CashuReceiveSwapService(
    cashuReceiveSwapRepo,
  );
  const cashuSendQuoteService = new CashuSendQuoteService(cashuSendQuoteRepo);
  const cashuSendSwapService = new CashuSendSwapService(
    cashuSendSwapRepo,
    cashuReceiveSwapService,
  );

  // Upsert user into Supabase (mirrors web app's _protected.tsx).
  // Without this, the user exists in OpenSecret but not in wallet.users,
  // so all Supabase queries fail with RLS denials.
  const [cashuLockingXpub, sparkMnemonic] = await Promise.all([
    cashuCrypto.getXpub(BASE_CASHU_LOCKING_DERIVATION_PATH),
    getSparkWalletMnemonic(),
  ]);
  const sparkIdentityPublicKey = await getSparkIdentityPublicKeyFromMnemonic(
    sparkMnemonic,
    'MAINNET',
  );
  const writeUserRepo = new WriteUserRepository(db, accountRepo);
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
    accountService,
    cashuReceiveQuoteService,
    cashuReceiveSwapService,
    cashuSendQuoteService,
    cashuSendSwapService,
    accountRepo,
    cashuReceiveQuoteRepo,
    cashuSendSwapRepo,
    transactionRepo,
    cache,
  };

  return cached;
}
