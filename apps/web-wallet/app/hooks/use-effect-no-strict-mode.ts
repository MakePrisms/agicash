import {
  type DependencyList,
  type EffectCallback,
  useEffect,
  useRef,
} from 'react';

// When running in Strict mode initial run of the effect is done twice. This causes some bug with React Router routing. See
// here https://github.com/remix-run/remix/issues/10320. More on strict mode can be seen here
// https://react.dev/reference/react/StrictMode.
/**
 * useEffect which opts out of initial re-run in StrictMode
 * @param effect
 * @param deps
 */
export const useEffectNoStrictMode = (
  effect: EffectCallback,
  deps?: DependencyList,
) => {
  const hasRunOnce = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: we are ignoring this because biome sees effect as missing dep. We can safely do that because effect will change only when the deps change too.
  useEffect(() => {
    // Strict mode is on only in development mode so no need to have special handling if we are not running in that mode
    const isDevelopmentMode = import.meta.env.MODE === 'development';
    if (!isDevelopmentMode || hasRunOnce.current) {
      return effect();
    }
    // Skip the initial StrictMode-induced re-run
    hasRunOnce.current = true;
  }, deps);
};
