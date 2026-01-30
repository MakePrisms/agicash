const FEATURE_FLAGS = {
  GUEST_SIGNUP: import.meta.env.VITE_FF_GUEST_SIGNUP === 'true',
  GIFT_CARDS: import.meta.env.VITE_FF_GIFT_CARDS === 'true',
} as const;

/**
 * Returns the value of a feature flag
 */
export const useFeatureFlag = (flag: keyof typeof FEATURE_FLAGS) =>
  FEATURE_FLAGS[flag];
