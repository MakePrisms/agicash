import { generateThirdPartyToken } from '@agicash/opensecret';
import type { AuthProvider } from '@cashu/cashu-ts';
import { jwtDecode } from 'jwt-decode';

type CachedCAT = {
  token: string;
  /** Epoch milliseconds at which the cached token should be considered stale. */
  refreshAt: number;
};

let cachedCAT: CachedCAT | undefined;
let inflight: Promise<string> | undefined;

/**
 * Computes the epoch-ms moment at which a CAT should be refreshed: 5 seconds
 * before its JWT `exp`, matching the Supabase token pattern. Tokens without an
 * `exp` claim are treated as immediately stale.
 */
function computeRefreshAt(token: string): number {
  const decoded = jwtDecode(token);
  if (!decoded.exp) return 0;
  return (decoded.exp - 5) * 1000;
}

async function fetchCAT(): Promise<string> {
  const response = await generateThirdPartyToken('agicash-mint');
  const token = response.token;
  cachedCAT = { token, refreshAt: computeRefreshAt(token) };
  return token;
}

/**
 * Returns a valid agicash-mint CAT, reusing the cached one until 5 seconds
 * before expiry and deduping concurrent refreshes behind a single in-flight
 * promise.
 */
async function ensureCAT(): Promise<string> {
  if (cachedCAT && Date.now() < cachedCAT.refreshAt) {
    return cachedCAT.token;
  }
  if (inflight) return inflight;

  inflight = fetchCAT().finally(() => {
    inflight = undefined;
  });
  return inflight;
}

/**
 * Returns a cashu-ts AuthProvider for NUT-21 Clear Auth on agicash gift card
 * mints. The token is cached in a module-level memo and refreshed automatically
 * 5 seconds before expiry.
 */
export function getAgicashMintAuthProvider(): AuthProvider {
  return {
    getCAT: () => {
      throw new Error('Not implemented: use ensureCAT');
    },
    setCAT: () => {
      throw new Error('Not implemented: use ensureCAT');
    },
    ensureCAT: () => ensureCAT(),
    getBlindAuthToken: async () => {
      throw new Error('Blind auth is not supported');
    },
  };
}

/**
 * Clears the cached CAT and any in-flight refresh. Must be called on sign-out:
 * the CAT is minted from the logged-in user's session, so without this a token
 * from one user could be served to another after a same-tab re-login.
 */
export function clearAgicashMintAuthToken(): void {
  cachedCAT = undefined;
  inflight = undefined;
}
