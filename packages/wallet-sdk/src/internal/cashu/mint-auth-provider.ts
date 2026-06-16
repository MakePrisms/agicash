import type { AuthProvider } from '@cashu/cashu-ts';
import { jwtDecode } from 'jwt-decode';
import type { AccountPurpose } from '../../domains/account-types';
import type { OpenSecret } from '../opensecret';

/**
 * Caches the agicash-mint CAT (Open Secret third-party token, audience
 * 'agicash-mint') until 5s before its JWT expiry, mirroring SessionTokenProvider.
 * Gift-card / offer mints require NUT-21 Clear Auth; transactional mints do not.
 */
export class AgicashMintAuthProvider {
  private cached: { token: string; expiresAtMs: number } | null = null;
  private inFlight: Promise<string | undefined> | null = null;

  constructor(
    private readonly os: Pick<OpenSecret, 'generateThirdPartyToken'>,
    private readonly isLoggedIn: () => Promise<boolean>,
  ) {}

  // Arrow so `this` stays bound when passed as AuthProvider.ensureCAT. The
  // in-flight guard restores the request dedup that React Query's fetchQuery
  // provided in the app (mirrors SessionTokenProvider).
  private ensureCAT = async (): Promise<string | undefined> => {
    if (this.cached && this.cached.expiresAtMs > Date.now()) {
      return this.cached.token;
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  };

  private async fetch(): Promise<string | undefined> {
    if (!(await this.isLoggedIn())) return undefined;
    const { token } = await this.os.generateThirdPartyToken('agicash-mint');
    const { exp } = jwtDecode<{ exp?: number }>(token);
    this.cached = { token, expiresAtMs: ((exp ?? 0) - 5) * 1000 };
    return token;
  }

  toAuthProvider(): AuthProvider {
    return {
      getCAT: () => {
        throw new Error('Not implemented: use ensureCAT');
      },
      setCAT: () => {
        throw new Error('Not implemented: use ensureCAT');
      },
      ensureCAT: this.ensureCAT,
      getBlindAuthToken: async () => {
        throw new Error('Blind auth is not supported');
      },
    };
  }

  clear(): void {
    this.cached = null;
    this.inFlight = null;
  }
}

/** Returns the agicash mint AuthProvider for gift-card/offer accounts, else undefined. */
export function getMintAuthProvider(
  purpose: AccountPurpose | undefined,
  agicashAuth: AgicashMintAuthProvider,
): AuthProvider | undefined {
  return purpose === 'gift-card' || purpose === 'offer'
    ? agicashAuth.toAuthProvider()
    : undefined;
}
