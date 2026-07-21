import * as openSecret from '@agicash/opensecret';
import type {
  AccountsApi,
  AuthApi,
  ContactsApi,
  FeatureFlagsApi,
  ReceiveApi,
  Sdk,
  SdkConfig,
  SendApi,
  TaskProcessorApi,
  TransactionsApi,
  TransferApi,
  UserApi,
  WalletEvents,
} from '.';
import { createAgicashDbClient } from '../../db/client';
import { createSupabaseSessionTokenGetter } from '../../db/supabase-session';
import { clearAgicashMintAuthToken } from '../../lib/agicash-mint-auth-provider';
import { NotImplementedError } from '../../lib/error';
import { generateRandomPassword } from '../../lib/password';
import {
  type SparkWalletConfig,
  clearSparkWallets,
} from '../../lib/spark/wallet';
import { createAccountsApi } from '../accounts/accounts-api';
import { AuthService } from '../user/auth-service';
import { createUserApi } from '../user/user-api';
import { WalletEventEmitter } from './events';
import { createSessionKeys } from './session-keys';

// The current instance: the instance currently constructed and not yet
// disposed. Makes the one-instance-per-process constraint (see the constructor
// note) self-enforcing: create() refuses to run while an undisposed instance
// holds the module-global Open Secret configuration.
let currentInstance: AgicashSdk | undefined;

/**
 * Runtime implementation of the SDK contract. Namespaces land slice by slice —
 * auth, user, accounts, and events so far; accessing a namespace whose migration
 * slice hasn't landed throws `NotImplementedError`.
 */
export class AgicashSdk implements Sdk {
  readonly auth: AuthApi;
  readonly user: UserApi;
  readonly accounts: AccountsApi;
  readonly events: WalletEvents;

  get contacts(): ContactsApi {
    throw new NotImplementedError('contacts');
  }
  get transactions(): TransactionsApi {
    throw new NotImplementedError('transactions');
  }
  get receive(): ReceiveApi {
    throw new NotImplementedError('receive');
  }
  get send(): SendApi {
    throw new NotImplementedError('send');
  }
  get transfer(): TransferApi {
    throw new NotImplementedError('transfer');
  }
  get featureFlags(): FeatureFlagsApi {
    throw new NotImplementedError('featureFlags');
  }
  get taskProcessor(): TaskProcessorApi {
    throw new NotImplementedError('taskProcessor');
  }

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
      generateToken: () => openSecret.generateThirdPartyToken(),
    });

    this.authService = new AuthService({
      os: openSecret,
      storage: config.auth.storage,
      generateGuestPassword: async () =>
        (await config.auth.generateGuestPassword?.()) ??
        generateRandomPassword(32),
      events,
      onSessionEnded: () => {
        // The token cache must die with the session: a token minted for one
        // user must never serve the next login's queries. Anything wiped here
        // must fence its own in-flight writes (a generation counter or abort
        // scope) so a write resolving after this reset can't repopulate it —
        // there is no cross-user backstop beyond each memo's own fence.
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
  }

  /** Sync; no I/O. Throws when an undisposed instance already exists (see the constructor note). */
  static create(config: SdkConfig): AgicashSdk {
    if (currentInstance) {
      throw new Error(
        'An AgicashSdk instance already exists in this process. @agicash/opensecret holds module-global auth state, so dispose() the previous instance before creating another.',
      );
    }
    currentInstance = new AgicashSdk(config);
    return currentInstance;
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
    if (currentInstance === this) {
      currentInstance = undefined;
    }
  }
}
