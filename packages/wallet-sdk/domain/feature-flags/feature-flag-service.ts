import type { AgicashDb } from '../../db/database';

export type FeatureFlag = 'GUEST_SIGNUP' | 'DEBUG_LOGGING_SPARK';
export type FeatureFlags = Record<FeatureFlag, boolean>;
export const FEATURE_FLAG_DEFAULTS: FeatureFlags = {
  GUEST_SIGNUP: false,
  DEBUG_LOGGING_SPARK: false,
};

class FeatureFlagService {
  constructor(private readonly db: AgicashDb) {}

  async fetchAll(): Promise<FeatureFlags> {
    const { data, error } = await this.db.rpc('evaluate_feature_flags');
    if (error) {
      throw new Error('Failed to fetch feature flags', { cause: error });
    }
    return data as FeatureFlags;
  }
}

const MAX_RETRIES = 3;

async function fetchAllWithRetry(
  service: FeatureFlagService,
): Promise<FeatureFlags> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await service.fetchAll();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * 2 ** attempt),
        );
      }
    }
  }
  throw lastError;
}

let currentFlags: FeatureFlags = FEATURE_FLAG_DEFAULTS;
let service: FeatureFlagService | undefined;
// Bumped per refresh so an earlier fetch that resolves late (e.g. the anon
// boot fetch racing the post-login one) cannot overwrite a newer result.
let generation = 0;
const listeners = new Set<() => void>();

/**
 * Wires the feature-flag store to a database. Call once per process (the web
 * client entry). Paths that never configure it (e.g. server routes) read
 * {@link FEATURE_FLAG_DEFAULTS} forever.
 */
export function configureFeatureFlags(db: AgicashDb): void {
  service = new FeatureFlagService(db);
}

/**
 * Synchronously reads a feature flag from the in-memory store: the most
 * recently fetched value, or the default before the first successful
 * {@link refreshFeatureFlags}.
 */
export function getFeatureFlag(flag: FeatureFlag): boolean {
  return currentFlags[flag];
}

/**
 * Subscribes to store updates. The listener fires after each successful
 * refresh.
 * @returns Unsubscribe function.
 */
export function subscribeToFeatureFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Resets the store to defaults, notifies subscribers, and discards any
 * in-flight refresh. Call on sign-out so one session's flags cannot leak into
 * the next (including via a refresh that was started before the reset).
 */
export function resetFeatureFlags(): void {
  generation++;
  currentFlags = FEATURE_FLAG_DEFAULTS;
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Fetches flags from the database into the store, retrying with exponential
 * backoff. Call after auth changes: the flags the database evaluates depend on
 * the caller's JWT (anon → global flags, user → user-targeted flags). When
 * refreshes overlap, the latest call wins regardless of resolution order.
 * @throws When all retries fail; the store keeps its last loaded values.
 */
export async function refreshFeatureFlags(): Promise<FeatureFlags> {
  if (!service) {
    throw new Error(
      'Feature flags are not configured. Call configureFeatureFlags first.',
    );
  }
  generation++;
  const startedIn = generation;
  const flags = await fetchAllWithRetry(service);
  if (startedIn === generation) {
    currentFlags = flags;
    for (const listener of listeners) {
      listener();
    }
  }
  return flags;
}
