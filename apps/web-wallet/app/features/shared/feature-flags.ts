import type { FeatureFlag } from '@agicash/wallet-sdk';
import {
  FEATURE_FLAG_DEFAULTS,
  getFeatureFlag,
  refreshFeatureFlags,
  resetFeatureFlags as resetFeatureFlagStore,
  subscribeToFeatureFlags,
} from '@agicash/wallet-sdk/temporary';
import * as Sentry from '@sentry/react-router';
import { use, useSyncExternalStore } from 'react';

let initialLoad: Promise<void> | undefined;

/**
 * Loads feature flags into the SDK store. Call at boot and after auth changes
 * (the database evaluates flags against the caller's JWT, so login swaps
 * global flags for user-targeted ones). Never rejects: a terminal fetch
 * failure is reported to Sentry and reads keep the last loaded values —
 * defaults before the first successful load.
 */
export function loadFeatureFlags(): Promise<void> {
  const load = refreshFeatureFlags().then(
    () => undefined,
    (error) => {
      Sentry.captureException(error);
    },
  );
  initialLoad ??= load;
  return load;
}

/**
 * Drops the session's flags on sign-out: resets the SDK store to defaults and
 * re-arms the initial-load gate, so the next flag consumer suspends until
 * fresh flags arrive instead of rendering the previous session's values.
 */
export function resetFeatureFlags(): void {
  initialLoad = undefined;
  resetFeatureFlagStore();
}

export function useFeatureFlag(flag: FeatureFlag): boolean {
  use(initialLoad ?? loadFeatureFlags());
  return useSyncExternalStore(
    subscribeToFeatureFlags,
    () => getFeatureFlag(flag),
    () => FEATURE_FLAG_DEFAULTS[flag],
  );
}
