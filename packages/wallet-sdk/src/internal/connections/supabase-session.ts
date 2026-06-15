import { jwtDecode } from 'jwt-decode';

/**
 * Provides a valid Supabase access token (the OpenSecret third-party JWT) on
 * demand, cached until ~5s before expiry, single-flighting concurrent fetches,
 * and returning `null` when no session is active. Framework-free (no query lib).
 */
export class SupabaseSessionTokenProvider {
  private token: string | null = null;
  private expMs = 0;
  private inflight: Promise<string | null> | null = null;

  constructor(
    private readonly generateToken: () => Promise<string>,
    private readonly isLoggedIn: () => Promise<boolean>,
  ) {}

  /** Returns a fresh-enough token, or null when logged out. */
  readonly getToken = async (): Promise<string | null> => {
    if (!(await this.isLoggedIn())) {
      this.token = null;
      return null;
    }
    if (this.token && Date.now() < this.expMs - 5000) {
      return this.token;
    }
    this.inflight ??= this.fetch();
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  };

  private async fetch(): Promise<string> {
    const token = await this.generateToken();
    const { exp } = jwtDecode<{ exp?: number }>(token);
    this.token = token;
    this.expMs = (exp ?? 0) * 1000;
    return token;
  }
}
