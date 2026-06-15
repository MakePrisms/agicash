import { jwtDecode } from 'jwt-decode';
import type { OpenSecret } from '../opensecret';

/** Provides the Supabase access token (Open Secret third-party JWT), cached
 * in-memory until 5s before its expiry. `isLoggedIn` gates the network call so
 * a signed-out instance never mints a token. */
export class SessionTokenProvider {
  private cached: { token: string; expiresAtMs: number } | null = null;
  private inFlight: Promise<string | null> | null = null;

  constructor(
    private readonly os: Pick<OpenSecret, 'generateThirdPartyToken'>,
    private readonly isLoggedIn: () => Promise<boolean>,
  ) {}

  getToken = async (): Promise<string | null> => {
    if (this.cached && this.cached.expiresAtMs > Date.now()) {
      return this.cached.token;
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  };

  private async fetch(): Promise<string | null> {
    if (!(await this.isLoggedIn())) return null;
    const { token } = await this.os.generateThirdPartyToken();
    const { exp } = jwtDecode<{ exp: number }>(token);
    this.cached = { token, expiresAtMs: (exp - 5) * 1000 };
    return token;
  }

  clear(): void {
    this.cached = null;
    this.inFlight = null;
  }
}
