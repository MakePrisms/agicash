import * as openSecret from '@agicash/opensecret';
import { createAgicashDbClient } from './db/client';
import { createSupabaseSessionTokenGetter } from './db/supabase-session';
import { AuthService } from './domain/user/auth-service';
import { createGuestAccountStorage } from './domain/user/guest-account-storage';
import { createUserApi } from './domain/user/user-api';
import { clearAgicashMintAuthToken } from './lib/agicash-mint-auth-provider';
import { WalletEventEmitter } from './lib/events';
import { generateRandomPassword } from './lib/password';
import { clearSparkWallets } from './lib/spark/wallet';
import type { AuthApi, Sdk, SdkConfig, UserApi, WalletEvents } from './sdk';

/**
 * Runtime implementation of the SDK contract, filled namespace-by-namespace
 * as the migration slices land (auth/user/events since step 5). Each slice
 * adds its namespace to the `Pick` until it collapses to the full `Sdk`.
 */
export class AgicashSdk
  implements Pick<Sdk, 'auth' | 'user' | 'events' | 'init' | 'dispose'>
{
  readonly auth: AuthApi;
  readonly user: UserApi;
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
      },
      logger: config.logger,
    });

    const db = createAgicashDbClient({
      url: config.db.url,
      anonKey: config.db.anonKey,
      accessToken: sessionToken.getToken,
    });

    this.auth = this.authService;
    this.user = createUserApi({
      db,
      getSession: () => this.authService.getSession(),
    });
    this.events = events;
  }

  /** Sync; no I/O. */
  static create(config: SdkConfig): AgicashSdk {
    return new AgicashSdk(config);
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
  }
}
