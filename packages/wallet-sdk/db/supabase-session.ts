import { jwtDecode } from 'jwt-decode';

type Deps = {
  isLoggedIn: () => boolean;
  /** Exchanges the Open Secret JWT for a Supabase third-party token. */
  generateToken: () => Promise<{ token: string }>;
};

export type SupabaseSessionTokenSource = {
  /** Supabase `accessToken` callback; null selects the anon key. */
  getToken: () => Promise<string | null>;
  /**
   * Drops the cached token. Must be called when the session ends — the cache
   * is otherwise only re-validated by expiry, and a token minted for one user
   * must never survive into another user's session.
   */
  reset: () => void;
};

/**
 * Builds the Supabase `accessToken` source: exchanges the Open Secret JWT
 * for a Supabase third-party token and memoizes it until 5 seconds before its
 * expiry. Concurrent callers share one in-flight exchange. Returns null when
 * no session exists (the client then uses the anon key).
 */
export function createSupabaseSessionTokenGetter(
  deps: Deps,
): SupabaseSessionTokenSource {
  const generateToken = deps.generateToken;
  let cached: { token: string; refreshAtMs: number } | undefined;
  let inFlight: Promise<string> | undefined;
  // Incremented on invalidation; an exchange started under an older
  // generation must not populate the cache — its token belongs to the ended
  // session.
  let generation = 0;

  const invalidate = () => {
    generation += 1;
    cached = undefined;
    inFlight = undefined;
  };

  return {
    reset: invalidate,
    getToken: async () => {
      if (!deps.isLoggedIn()) {
        // Same full invalidation as reset(): an exchange in flight when the
        // session ended must not populate the cache either.
        invalidate();
        return null;
      }
      if (cached && Date.now() < cached.refreshAtMs) {
        return cached.token;
      }
      if (!inFlight) {
        const startedGeneration = generation;
        inFlight = (async () => {
          try {
            const { token } = await generateToken();
            if (generation === startedGeneration) {
              const { exp } = jwtDecode(token);
              cached = { token, refreshAtMs: exp ? (exp - 5) * 1000 : 0 };
            }
            return token;
          } finally {
            if (generation === startedGeneration) {
              inFlight = undefined;
            }
          }
        })();
      }
      return inFlight;
    },
  };
}
