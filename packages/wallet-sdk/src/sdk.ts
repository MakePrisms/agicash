import { jwtDecode } from 'jwt-decode';
import type { SdkConfig } from './config';
import { AuthDomain } from './domains/auth';
import type { SdkCoreEventMap } from './events';
import { createAgicashDb } from './internal/db/client';
import { SessionTokenProvider } from './internal/db/session-token';
import { WriteUserRepository } from './internal/db/user-repository';
import { EventBus } from './internal/event-bus';
import { KeyService } from './internal/keys';
import { type OpenSecret, realOpenSecret } from './internal/opensecret';
import { createOpenSecretStorage } from './internal/opensecret-storage';

const REFRESH_TOKEN_KEY = 'refresh_token';

/**
 * Entry point. `Sdk.create(config)` configures Open Secret (with a StorageProvider
 * bridged to the host's async StorageAdapter), constructs the Supabase client +
 * session-token provider, and wires the auth domain. React-free; usable headless.
 */
export class Sdk {
  readonly auth: AuthDomain;
  private readonly events: EventBus<SdkCoreEventMap>;
  private readonly keys: KeyService;
  private readonly sessionToken: SessionTokenProvider;

  private constructor(parts: {
    auth: AuthDomain;
    events: EventBus<SdkCoreEventMap>;
    keys: KeyService;
    sessionToken: SessionTokenProvider;
  }) {
    this.auth = parts.auth;
    this.events = parts.events;
    this.keys = parts.keys;
    this.sessionToken = parts.sessionToken;
  }

  static async create(
    config: SdkConfig,
    // Test seam: inject a fake Open Secret port. Production uses realOpenSecret.
    deps: { openSecret?: OpenSecret } = {},
  ): Promise<Sdk> {
    const os = deps.openSecret ?? realOpenSecret;
    const events = new EventBus<SdkCoreEventMap>();
    const storage = createOpenSecretStorage(
      config.storage,
      config.sessionStorage,
    );

    os.configure({
      apiUrl: config.openSecret.url,
      clientId: config.openSecret.clientId,
      storage,
    });

    const keys = new KeyService(os);

    const isLoggedIn = async (): Promise<boolean> => {
      const refresh = await config.storage.get(REFRESH_TOKEN_KEY);
      if (!refresh) return false;
      try {
        const { exp } = jwtDecode<{ exp?: number }>(refresh);
        return !!exp && exp * 1000 > Date.now();
      } catch {
        return false;
      }
    };

    const sessionToken = new SessionTokenProvider(os, isLoggedIn);
    const db = createAgicashDb(config.supabase, sessionToken.getToken);
    const writeUserRepo = new WriteUserRepository(db);

    const auth = new AuthDomain({
      os,
      keys,
      events,
      storage: config.storage,
      writeUserRepo,
      sessionToken,
      storageSession: storage,
      network: 'MAINNET',
      includeTestAccounts: config.includeTestAccounts ?? false,
    });

    // Re-arm the session-expiry timer if a session is already present.
    await auth.initialize();

    return new Sdk({ auth, events, keys, sessionToken });
  }

  /** Subscribe to a core event. Returns an unsubscribe function. */
  on<E extends keyof SdkCoreEventMap>(
    event: E,
    cb: (payload: SdkCoreEventMap[E]) => void,
  ): () => void {
    return this.events.on(event, cb);
  }

  /** Coarse, idempotent catch-up hint. No realtime/processors yet (Plan 4) — no-op. */
  async resync(): Promise<void> {}

  /** Close down: stop the expiry timer, drop all secret material, clear listeners. */
  async dispose(): Promise<void> {
    this.auth.cancelSessionExpiry();
    this.keys.clear();
    this.sessionToken.clear();
    this.events.clear();
  }
}
