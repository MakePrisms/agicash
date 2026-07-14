import * as openSecret from '@agicash/opensecret';
import { createAgicashDbClient } from './db/client';
import { createSupabaseSessionTokenGetter } from './db/supabase-session';
import type { AccountRepository } from './domain/accounts/account-repository';
import { createAccountsApi } from './domain/accounts/accounts-api';
import { AuthService } from './domain/user/auth-service';
import { createGuestAccountStorage } from './domain/user/guest-account-storage';
import { createUserApi } from './domain/user/user-api';
import { clearAgicashMintAuthToken } from './lib/agicash-mint-auth-provider';
import { WalletEventEmitter } from './lib/events';
import { generateRandomPassword } from './lib/password';
import { type SparkWalletConfig, clearSparkWallets } from './lib/spark/wallet';
import type {
  AccountsApi,
  AuthApi,
  Sdk,
  SdkConfig,
  UserApi,
  WalletEvents,
} from './sdk';
import { createSessionKeys } from './session-keys';

// Makes the one-instance-per-process constraint (see the constructor note)
// self-enforcing: create() refuses to run while an undisposed instance holds
// the module-global Open Secret configuration.
let liveInstance: AgicashSdk | undefined;

// The live instance's internal accounts repository builder, reached only
// through the '@agicash/wallet-sdk/temporary' bridge (removed at step 18).
// Module-scoped like liveInstance so the bridge never exposes the fat domain
// repository on the public AgicashSdk surface.
let liveAccountRepository: (() => Promise<AccountRepository>) | undefined;

/**
 * Runtime implementation of the SDK contract, filled namespace-by-namespace
 * as the migration slices land (auth/user/events since step 5). Each slice
 * adds its namespace to the `Pick` until it collapses to the full `Sdk`.
 */
export class AgicashSdk
  implements
    Pick<Sdk, 'auth' | 'user' | 'accounts' | 'events' | 'init' | 'dispose'>
{
  readonly auth: AuthApi;
  readonly user: UserApi;
  readonly accounts: AccountsApi;
  readonly events: WalletEvents;

  private readonly authService: AuthService;

  private constructor(config: SdkConfig) {
    // The Open Secret client is module-scoped in @agicash/opensecret, so auth
    // configuration is process-global: a second AgicashSdk instance would
    // re-configure it. One instance per process until the library ships an
    // instance API.
    openSecret.configure({
      apiUrl: config.auth.apiUrl,
      clientId: config.auth.clientId,
      storage: config.auth.storage,
    });

    const events = new WalletEventEmitter(config.logger);

    const keys = createSessionKeys();

    // Created before authService — the isLoggedIn closure dereferences it
    // lazily at request time, after the constructor has assigned it.
    const sessionToken = createSupabaseSessionTokenGetter({
      isLoggedIn: () => this.authService.getSession().isLoggedIn,
    });

    this.authService = new AuthService({
      os: openSecret,
      storage: config.auth.storage,
      guestAccountStorage: createGuestAccountStorage(
        config.auth.storage.persistent,
        config.logger,
      ),
      generateGuestPassword: async () =>
        (await config.auth.generateGuestPassword?.()) ??
        generateRandomPassword(32),
      events,
      onSessionEnded: () => {
        // The token cache must die with the session: a token minted for one
        // user must never serve the next login's queries.
        sessionToken.reset();
        clearSparkWallets();
        clearAgicashMintAuthToken();
        keys.reset();
      },
      logger: config.logger,
    });

    const db = createAgicashDbClient({
      url: config.db.url,
      anonKey: config.db.anonKey,
      accessToken: sessionToken.getToken,
    });

    const sparkConfig: SparkWalletConfig = {
      storageDir: config.spark.storageDir ?? './.spark-data',
      apiKey: config.spark.breezApiKey,
    };
    const accounts = createAccountsApi({
      db,
      getSession: () => this.authService.getSession(),
      keys,
      sparkConfig,
    });

    this.auth = this.authService;
    this.user = createUserApi({
      db,
      getSession: () => this.authService.getSession(),
      keys,
      getAccountRepository: accounts.getRepository,
    });
    this.accounts = accounts.api;
    this.events = events;
    liveAccountRepository = accounts.getRepository;
  }

  /** Sync; no I/O. Throws when an undisposed instance already exists (see the constructor note). */
  static create(config: SdkConfig): AgicashSdk {
    if (liveInstance) {
      throw new Error(
        'An AgicashSdk instance already exists in this process. @agicash/opensecret holds module-global auth state, so dispose() the previous instance before creating another.',
      );
    }
    liveInstance = new AgicashSdk(config);
    return liveInstance;
  }

  /**
   * Session restore only for now — the Breez WASM load folds in when the
   * first Spark slice lands. Resolves when no session exists. Delegates
   * to the auth service, which is single-flight and memoizes success but
   * clears a rejection, so the host's query retries can recover.
   */
  init(): Promise<void> {
    return this.authService.restoreSession();
  }

  async dispose(): Promise<void> {
    this.authService.teardown();
    if (liveInstance === this) {
      liveInstance = undefined;
      liveAccountRepository = undefined;
    }
  }
}

/**
 * The live instance's internal fat domain accounts repository, for unmigrated
 * web flows (receive/send repo construction, realtime row mapping) that still
 * read wallet/proofs. Re-exported from '@agicash/wallet-sdk/temporary'; not on
 * the public surface.
 *
 * @remarks Removed at step 18 when those flows read wallet/proofs from the SDK.
 */
export function getInternalAccountRepository(): Promise<AccountRepository> {
  if (!liveAccountRepository) {
    throw new Error('No live AgicashSdk instance');
  }
  return liveAccountRepository();
}
