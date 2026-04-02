import type { AuthProvider } from '@cashu/cashu-ts';
import { generateThirdPartyToken } from '@agicash/opensecret-sdk';
import type { AccountPurpose } from '@agicash/sdk/features/accounts/account';

const AGICASH_MINT_AUDIENCE = 'agicash-mint';

/**
 * Refresh the token 5 seconds before it expires,
 * matching the web app's approach.
 */
const EXPIRY_BUFFER_MS = 5_000;

/**
 * Decode a JWT payload without pulling in jwt-decode.
 * JWTs are three base64url segments separated by dots.
 */
function decodeJwtPayload(token: string): { exp?: number } {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payload = parts[1]!;
  // base64url → base64
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(base64, 'base64').toString('utf-8');
  return JSON.parse(json);
}

/**
 * Creates a cashu-ts AuthProvider backed by OpenSecret's third-party tokens.
 *
 * Uses an in-memory cache — the token is regenerated only when it is missing
 * or within 5 seconds of expiry.
 */
export function createOpenSecretAuthProvider(): AuthProvider {
  let cachedToken: string | undefined;
  let cachedExpiryMs: number | undefined;

  function isTokenValid(): boolean {
    if (!cachedToken || cachedExpiryMs == null) return false;
    return Date.now() < cachedExpiryMs - EXPIRY_BUFFER_MS;
  }

  return {
    async ensureCAT(): Promise<string | undefined> {
      if (isTokenValid()) {
        return cachedToken;
      }

      const response = await generateThirdPartyToken(AGICASH_MINT_AUDIENCE);
      cachedToken = response.token;

      const payload = decodeJwtPayload(response.token);
      cachedExpiryMs = payload.exp ? payload.exp * 1000 : undefined;

      return cachedToken;
    },

    getCAT(): string | undefined {
      return cachedToken;
    },

    setCAT(cat: string | undefined): void {
      cachedToken = cat;
      if (cat) {
        const payload = decodeJwtPayload(cat);
        cachedExpiryMs = payload.exp ? payload.exp * 1000 : undefined;
      } else {
        cachedExpiryMs = undefined;
      }
    },

    async getBlindAuthToken(): Promise<string> {
      throw new Error('Blind auth is not supported');
    },
  };
}

/**
 * Singleton auth provider — all gift-card accounts share one cached token.
 */
let sharedAuthProvider: AuthProvider | undefined;

/**
 * Returns an auth provider for gift-card purpose accounts, undefined otherwise.
 * Suitable as the `getMintAuthProvider` callback for AccountRepository.
 */
export function getMintAuthProvider(
  purpose: AccountPurpose | undefined,
): AuthProvider | undefined {
  if (purpose !== 'gift-card') {
    return undefined;
  }
  if (!sharedAuthProvider) {
    sharedAuthProvider = createOpenSecretAuthProvider();
  }
  return sharedAuthProvider;
}
