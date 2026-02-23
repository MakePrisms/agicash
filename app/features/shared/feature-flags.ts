import { useBooleanFlagValue } from '@openfeature/react-sdk';
import {
  ErrorCode,
  type EvaluationContext,
  type JsonValue,
  OpenFeature,
  type Provider,
  type ResolutionDetails,
  StandardResolutionReasons,
} from '@openfeature/web-sdk';
import { agicashDbClient } from '~/features/agicash-db/database.client';

export type FeatureFlag = 'GUEST_SIGNUP' | 'GIFT_CARDS';

type FeatureFlags = Partial<Record<FeatureFlag, boolean>>;

class SupabaseFeatureFlagProvider implements Provider {
  public readonly runsOn = 'client' as const;
  readonly metadata = { name: 'supabase-feature-flags' } as const;

  private flags: FeatureFlags = {};

  private async fetchFlags(): Promise<FeatureFlags> {
    const { data, error } = await agicashDbClient.rpc('evaluate_feature_flags');

    if (error) {
      console.error('Failed to fetch feature flags', { cause: error });
      return {};
    }

    return (data ?? {}) as FeatureFlags;
  }

  async initialize(): Promise<void> {
    this.flags = await this.fetchFlags();
  }

  async onContextChange(
    oldContext: EvaluationContext,
    newContext: EvaluationContext,
  ): Promise<void> {
    if (oldContext.targetingKey === newContext.targetingKey) return;
    this.flags = await this.fetchFlags();
  }

  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
  ): ResolutionDetails<boolean> {
    const value = this.flags[flagKey as FeatureFlag];
    if (value === undefined) {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: ErrorCode.FLAG_NOT_FOUND,
      };
    }
    return { value, reason: StandardResolutionReasons.STATIC };
  }

  resolveStringEvaluation(
    _flagKey: string,
    defaultValue: string,
  ): ResolutionDetails<string> {
    return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT };
  }

  resolveNumberEvaluation(
    _flagKey: string,
    defaultValue: number,
  ): ResolutionDetails<number> {
    return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT };
  }

  resolveObjectEvaluation<T extends JsonValue>(
    _flagKey: string,
    defaultValue: T,
  ): ResolutionDetails<T> {
    return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT };
  }
}

/**
 * Registers the OpenFeature provider on the client.
 * Uses setProvider (not setProviderAndWait) so the app renders immediately
 * with defaults while the provider initializes in the background.
 */
export function initFeatureFlags() {
  if (typeof window !== 'undefined') {
    OpenFeature.setProvider(new SupabaseFeatureFlagProvider());
  }
}

/**
 * Returns the value of a feature flag. Defaults to `false` during loading and on error.
 * Suspends until the provider is ready.
 */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  return useBooleanFlagValue(flag, false, { suspendUntilReady: true });
}
