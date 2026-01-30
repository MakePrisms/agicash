import { useSearchParams } from 'react-router';

type PathWithSearch = { pathname: string; search: string };

type UseRedirectToReturn = {
  /** The final destination path (from URL param or default) */
  redirectTo: string;
  /**
   * Creates a navigation target that preserves all current search params.
   *
   * Use this when navigating between steps in a flow to maintain the `redirectTo`
   * param (and any other search params) throughout the entire flow.
   *
   * @param pathname - The path to navigate to
   * @param extra - Additional search params to merge (will override existing keys)
   *
   * @example
   * ```tsx
   * // Current URL: /receive?redirectTo=/home&amount=100
   * const to = buildTo('/receive/confirm', { step: '2' });
   * // Result: { pathname: '/receive/confirm', search: 'redirectTo=/home&amount=100&step=2' }
   * ```
   */
  buildTo: (pathname: string, extra?: Record<string, string>) => PathWithSearch;
};

/**
 * Manages redirect URLs for multi-step flows (e.g., receive, send).
 *
 * Reads the `redirectTo` search param from the current URL to determine where
 * to navigate after the flow completes. If not present, falls back to `defaultPath`.
 *
 * @param defaultPath - Fallback path when no `redirectTo` param exists (default: '/')
 *
 * @example
 * ```tsx
 * // URL: /receive?redirectTo=/transactions/123
 * const { redirectTo, buildTo } = useRedirectTo('/');
 *
 * // After flow completes, navigate to the original page
 * navigate(redirectTo); // navigates to '/transactions/123'
 *
 * // Navigate to next step while preserving redirectTo
 * navigate(buildTo('/receive/confirm')); // '/receive/confirm?redirectTo=/transactions/123'
 * ```
 *
 * @returns
 * - `redirectTo` - The final destination path (from URL param or default)
 * - `buildTo` - Helper to create navigation objects that preserve all search params
 */
export const useRedirectTo = (defaultPath = '/'): UseRedirectToReturn => {
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') ?? defaultPath;

  const buildTo = (
    pathname: string,
    extra?: Record<string, string>,
  ): PathWithSearch => {
    const params = new URLSearchParams(searchParams);
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        params.set(key, value);
      }
    }
    return {
      pathname,
      search: params.toString(),
    };
  };

  return { redirectTo, buildTo };
};
