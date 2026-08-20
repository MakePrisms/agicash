import * as openSecret from '@agicash/opensecret';
import type {
  AccountsApi,
  AuthApi,
  AuthSession,
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
import { DisposedError, NotImplementedError } from '../../lib/error';
import { generateRandomPassword } from '../../lib/password';
import {
  type SparkWalletConfig,
  clearSparkWallets,
} from '../../lib/spark/wallet';
import { ensureBreezWasm } from '../../lib/spark/wasm';
import { createAccountsApi } from '../accounts/accounts-api';
import { createContactsApi } from '../contacts/contacts-api';
import { createReceiveApi } from '../receive/receive-api';
import { createTransactionsApi } from '../transactions/transactions-api';
import { AuthService } from '../user/auth-service';
import { createUserApi } from '../user/user-api';
import { WalletEventEmitter } from './events';
import { type OwnedSessionKeys, createSessionKeys } from './session-keys';
import { createUserProvisioner } from './user-provisioner';

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
  readonly contacts: ContactsApi;
  readonly transactions: TransactionsApi;
  readonly receive: ReceiveApi;
  readonly events: WalletEvents;

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
  private readonly keys: OwnedSessionKeys;
  private disposed = false;

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
    this.keys = keys;

    // Created before authService — the isLoggedIn closure dereferences it
    // lazily at request time, after the constructor has assigned it.
    const sessionToken = createSupabaseSessionTokenGetter({
      isLoggedIn: () => this.authService.getSession().isLoggedIn,
      generateToken: () => openSecret.generateThirdPartyToken(),
    });

    // Provisioning runs internally, post-establish, as the settled identity —
    // fingerprint-guarded so it re-provisions only when the identity changes,
    // held in memory, not persisted. A terminal failure propagates to the caller
    // so the host surfaces its error boundary; a session-lifecycle abort is moot
    // for the session that is starting. The guard resets on session end (below)
    // so a same-user re-login re-provisions the caches the end cleared.
    const userProvisioner = createUserProvisioner({
      provision: () => this.user.provision(),
      emit: (payload) => events.emit('auth.session-started', payload),
    });

    this.authService = new AuthService({
      os: openSecret,
      storage: config.auth.storage,
      generateGuestPassword: async () =>
        (await config.auth.generateGuestPassword?.()) ??
        generateRandomPassword(32),
      events,
      onSessionStarted: userProvisioner.provision,
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
        // Provisioning state is session-scoped too: after a sign-out the next
        // login — even the same user — must re-provision and re-emit
        // auth.session-started so the host reseeds the caches it cleared on end.
        userProvisioner.reset();
        events.clear();
      },
      logger: config.logger,
    });

    // The namespaces read the session through this, not the public
    // auth.getSession(): a call on a namespace handle retained across dispose()
    // rejects instead of acting on the dead instance's last session snapshot.
    const getLiveSession = (): AuthSession => {
      if (this.disposed) {
        throw new DisposedError();
      }
      return this.authService.getSession();
    };

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
      getSession: getLiveSession,
      keys,
      sparkConfig,
    });

    this.auth = this.authService;
    this.user = createUserApi({
      db,
      getSession: getLiveSession,
      keys,
      getAccountRepository: accounts.getRepository,
    });
    this.accounts = accounts.api;
    this.contacts = createContactsApi({
      db,
      getSession: getLiveSession,
      keys,
      lightningAddressDomain: config.lightningAddressDomain,
    });
    this.transactions = createTransactionsApi({
      db,
      getSession: getLiveSession,
      keys,
    });
    this.receive = createReceiveApi({
      db,
      getSession: getLiveSession,
      keys,
      getAccountRepository: accounts.getRepository,
    });
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
   * Front-loads session restore and the Breez WASM load (see the `Sdk.init`
   * contract). Session restore delegates to the auth service, which is
   * single-flight and memoizes success but clears a rejection, so the host's
   * query retries can recover.
   */
  init(): Promise<void> {
    return Promise.all([
      this.authService.restoreSession(),
      ensureBreezWasm(),
    ]).then(() => undefined);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.authService.teardown();
    this.keys.dispose();
    if (currentInstance === this) {
      currentInstance = undefined;
    }
  }
}
