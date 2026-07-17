import type { FeatureFlag } from '../feature-flags/feature-flag-service';

/** Flags are a process-local cached read — the one no-cache exception. */
export type FeatureFlagsApi = {
  get(flag: FeatureFlag): boolean;
  /** Cache-change signal; returns unsubscribe. */
  subscribe(listener: () => void): () => void;
};
