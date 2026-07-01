import type { AgicashDb } from '../db/database';

export type FeatureFlag = 'GUEST_SIGNUP' | 'DEBUG_LOGGING_SPARK';
export type FeatureFlags = Record<FeatureFlag, boolean>;
/** Synchronous live read of a feature flag, injected by the host. */
export type FeatureFlagReader = (flag: FeatureFlag) => boolean;
export const FEATURE_FLAG_DEFAULTS: FeatureFlags = {
  GUEST_SIGNUP: false,
  DEBUG_LOGGING_SPARK: false,
};

export class FeatureFlagService {
  constructor(private readonly db: AgicashDb) {}

  async fetchAll(): Promise<FeatureFlags> {
    const { data, error } = await this.db.rpc('evaluate_feature_flags');
    if (error) {
      throw new Error('Failed to fetch feature flags', { cause: error });
    }
    return data as FeatureFlags;
  }
}
