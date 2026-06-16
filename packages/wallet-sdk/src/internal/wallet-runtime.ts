import {
  type CashuCryptography,
  createCashuCryptography,
} from './cashu/cryptography';
import { AgicashMintAuthProvider } from './cashu/mint-auth-provider';
import { MintDataCache } from './cashu/mint-cache';
import { createEncryption } from './crypto/create-encryption';
import type { Encryption } from './crypto/encryption';
import { AccountRepository } from './db/account-repository';
import type { AgicashDb } from './db/database';
import { DefaultAccountRepository } from './db/default-account-repository';
import type { KeyService } from './keys';
import type { OpenSecret } from './opensecret';
import { AccountService } from './services/account-service';
import { SparkWalletManager } from './spark/wallet-manager';

export type WalletRuntime = {
  encryption: Encryption;
  cashuCryptography: CashuCryptography;
  mintCache: MintDataCache;
  mintAuth: AgicashMintAuthProvider;
  sparkWallets: SparkWalletManager;
  accountRepository: AccountRepository;
  defaultAccountRepository: DefaultAccountRepository;
  accountService: AccountService;
  dispose(): Promise<void>;
};

type Deps = {
  db: AgicashDb;
  keys: KeyService;
  os: OpenSecret;
  isLoggedIn: () => Promise<boolean>;
  breezApiKey: string;
  sparkStorageDir: string;
};

/**
 * Constructs the SDK-internal wallet runtime (encryption, cashu/spark runtimes,
 * account repo/service). Pure construction — no I/O at build time; spark
 * connect() and mint fetches happen lazily on first use. No public domain facade
 * is wired here — the protocol services (Plan 3b) and the variant facades read
 * from this runtime. dispose() disconnects spark wallets and clears the
 * mint/auth caches.
 */
export function createWalletRuntime(deps: Deps): WalletRuntime {
  const encryption = createEncryption(deps.keys);
  const cashuCryptography = createCashuCryptography(deps.keys, deps.os);
  const mintCache = new MintDataCache();
  const mintAuth = new AgicashMintAuthProvider(deps.os, deps.isLoggedIn);
  const sparkWallets = new SparkWalletManager(
    deps.keys,
    deps.breezApiKey,
    deps.sparkStorageDir,
  );
  const accountRepository = new AccountRepository(
    deps.db,
    encryption,
    deps.keys,
    mintCache,
    mintAuth,
    sparkWallets,
  );
  const defaultAccountRepository = new DefaultAccountRepository(
    deps.db,
    mintCache,
    mintAuth,
    sparkWallets,
  );
  const accountService = new AccountService(accountRepository, mintCache);

  return {
    encryption,
    cashuCryptography,
    mintCache,
    mintAuth,
    sparkWallets,
    accountRepository,
    defaultAccountRepository,
    accountService,
    dispose: async () => {
      mintAuth.clear();
      mintCache.clear();
      await sparkWallets.dispose();
    },
  };
}
