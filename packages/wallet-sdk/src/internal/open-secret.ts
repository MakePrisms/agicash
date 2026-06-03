/**
 * OpenSecret client wiring — §1 / Slice 0 connection wiring.
 *
 * The `@agicash/opensecret` package (the enclave/auth backend) is configured via a
 * module-global `configure({ apiUrl, clientId })` and then used through standalone
 * functions (`signIn`, `generateThirdPartyToken`, …) — there is no per-instance client
 * object. This module isolates that wiring behind a tiny `OpenSecretClient` facade so
 * the rest of the SDK does not call the global API directly, and so the auth slice has
 * one place to attach session handling.
 *
 * SESSION / STORAGE NOTE. `@agicash/opensecret` persists its own access/refresh tokens
 * (today: `localStorage`); `configure()` does NOT accept a storage adapter. So session
 * RESUME comes "for free" from the OpenSecret client rehydrating on init — there is no
 * storage-injection seam in the installed package. The SDK still HOLDS `config.storage`
 * (threaded to {@link OpenSecretClient}) for the auth slice's own state (e.g. the guest
 * refresh-token path master reads from `localStorage`) and for the day the OpenSecret
 * SDK exposes pluggable storage. See the report / build-plan: the `@agicash/opensecret-sdk`
 * pluggable-storage contract referenced in PR1 is NOT the installed package's API.
 *
 * @module
 */
import { configure, generateThirdPartyToken } from '@agicash/opensecret';
import type { StorageAdapter } from '../types/dependencies';

/** Init params for the OpenSecret client (from `SdkConfig.openSecret`). */
export type OpenSecretConfig = {
  /** enclave/auth backend URL (master `VITE_OPEN_SECRET_API_URL`). */
  url: string;
  /** project/tenant client id (master `VITE_OPEN_SECRET_CLIENT_ID`). */
  clientId: string;
};

/**
 * Thin facade over the module-global `@agicash/opensecret` SDK. One per `Sdk` instance.
 *
 * PR2 wires CONFIGURATION + the third-party-token fetch (the only OpenSecret surface the
 * core connection layer needs — it feeds the Supabase access-token provider). Auth
 * methods (`signIn` / `signUp` / OAuth / session-expiry) are wired in the auth slice.
 */
export class OpenSecretClient {
  /**
   * @param config - the `{ url, clientId }` enclave params.
   * @param storage - the pluggable storage adapter (held for the auth slice; see the
   *   module note on why it is not passed to `configure`).
   */
  constructor(
    config: OpenSecretConfig,
    readonly storage: StorageAdapter,
  ) {
    if (!config.url) {
      throw new Error('SdkConfig.openSecret.url is required');
    }
    if (!config.clientId) {
      throw new Error('SdkConfig.openSecret.clientId is required');
    }
    // Module-global; idempotent for a given process. With a single SDK instance per
    // process (the contract's topology) this is the one configuration point.
    configure({ apiUrl: config.url, clientId: config.clientId });
  }

  /**
   * Fetch an OpenSecret third-party JWT for the given `audience` (e.g. the Supabase
   * project). Thin pass-through to `generateThirdPartyToken`; the staleness/caching
   * lives in {@link SupabaseSessionTokenProvider}.
   *
   * @param audience - optional token audience.
   * @returns the JWT string.
   */
  async generateThirdPartyToken(audience?: string): Promise<string> {
    const { token } = await generateThirdPartyToken(audience);
    return token;
  }
}
