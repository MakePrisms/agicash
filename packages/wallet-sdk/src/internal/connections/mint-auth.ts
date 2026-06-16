import type { AuthProvider } from '@cashu/cashu-ts';
import { jwtDecode } from 'jwt-decode';
import type { AccountPurpose } from '../../types/account';

/**
 * Caches the agicash mint Clear-Auth token (CAT), refreshing 5s before expiry.
 * Mirrors {@link SupabaseSessionTokenProvider}; replaces the web's queryClient
 * memo for `agicash-mint-auth-token`.
 */
export class MintAuthTokenProvider {
  private token: string | null = null;
  private expMs = 0;
  private inflight: Promise<string | null> | null = null;

  constructor(
    private readonly generateToken: () => Promise<string>,
    private readonly isLoggedIn: () => Promise<boolean>,
  ) {}

  getToken = async (): Promise<string | null> => {
    if (!(await this.isLoggedIn())) {
      this.token = null;
      return null;
    }
    if (this.token && Date.now() < this.expMs - 5000) return this.token;
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

/** A cashu-ts `AuthProvider` for NUT-21 Clear Auth backed by {@link MintAuthTokenProvider}. */
export function getAgicashMintAuthProvider(
  tokenProvider: MintAuthTokenProvider,
): AuthProvider {
  return {
    getCAT: () => {
      throw new Error('Not implemented: use ensureCAT');
    },
    setCAT: () => {
      throw new Error('Not implemented: use ensureCAT');
    },
    ensureCAT: async () => (await tokenProvider.getToken()) ?? undefined,
    getBlindAuthToken: async () => {
      throw new Error('Blind auth is not supported');
    },
  };
}

/** The auth provider for an account purpose: gift-card/offer get the agicash CAT; others none. */
export function getMintAuthProvider(
  purpose: AccountPurpose,
  tokenProvider: MintAuthTokenProvider,
): AuthProvider | undefined {
  return purpose === 'gift-card' || purpose === 'offer'
    ? getAgicashMintAuthProvider(tokenProvider)
    : undefined;
}
