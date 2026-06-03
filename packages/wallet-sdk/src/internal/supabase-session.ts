/**
 * SDK-internal Supabase access-token provider — §1 / Slice 0 connection wiring.
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/agicash-db/supabase-session.ts`. The master form
 * pulls the OpenSecret third-party JWT through a module-level TanStack
 * `getQueryClient().fetchQuery(...)` whose `staleTime` is computed from the JWT `exp`
 * (refresh 5 s before expiry). This re-housing keeps the SAME staleness logic but
 * drops TanStack: a tiny in-memory cached-token getter.
 *
 * The result is the `accessToken: () => Promise<string | null>` callback the
 * SDK-owned Supabase client uses for RLS-scoped reads (the token = the OpenSecret
 * JWT, audience = the Supabase project). `null` is returned when no session exists.
 *
 * @module
 */
import { jwtDecode } from 'jwt-decode';

/** Refresh the token this many ms before its `exp` (matches master's 5 s guard). */
const EXPIRY_GUARD_MS = 5_000;

/**
 * Fetches a fresh OpenSecret third-party token. Injected (rather than importing
 * `@agicash/opensecret` directly) so this stays a pure mechanism the auth slice wires
 * to `generateThirdPartyToken`, and so it is trivially testable.
 *
 * Returns `null` when there is no authenticated session (mirrors master's
 * `isLoggedIn()` short-circuit).
 */
export type FetchSessionToken = () => Promise<string | null>;

/**
 * A cached, auto-refreshing access-token getter.
 *
 * Caches the last token and only re-fetches once it is within {@link EXPIRY_GUARD_MS}
 * of its JWT `exp` (or has none). Concurrent callers during a refresh share the single
 * in-flight fetch (no thundering herd). All state is instance-local — no globals.
 */
export class SupabaseSessionTokenProvider {
  private cached: string | null = null;
  private inFlight: Promise<string | null> | null = null;

  /**
   * @param fetchToken - obtains a fresh token (e.g. `generateThirdPartyToken` → `.token`),
   *   or `null` when signed out.
   * @param now - clock injection for tests (defaults to `Date.now`).
   */
  constructor(
    private readonly fetchToken: FetchSessionToken,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * The Supabase `accessToken` callback: returns a valid (non-stale) token, fetching
   * a new one only when the cached token is missing or about to expire.
   *
   * @returns the current access token, or `null` if signed out.
   */
  getToken = async (): Promise<string | null> => {
    if (this.cached && this.msToExpiry(this.cached) > 0) {
      return this.cached;
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.fetchToken()
      .then((token) => {
        this.cached = token;
        return token;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  };

  /** Drop the cached token (e.g. on sign-out) so the next `getToken` re-fetches. */
  clear(): void {
    this.cached = null;
  }

  /**
   * Milliseconds until `token` should be refreshed: `(exp - guard) - now`, clamped at
   * 0. A token with no `exp` is treated as immediately stale (returns 0). Mirrors the
   * master `staleTime` computation.
   */
  private msToExpiry(token: string): number {
    const { exp } = jwtDecode(token);
    if (!exp) {
      return 0;
    }
    return Math.max(exp * 1000 - EXPIRY_GUARD_MS - this.now(), 0);
  }
}
