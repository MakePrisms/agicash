import { useSearchParams } from 'react-router';

/**
 * Reads the `redirectTo` search param from the current URL to determine where
 * to navigate after a flow completes. If not present, falls back to `defaultPath`.
 *
 * @param defaultPath - Fallback path when no `redirectTo` param exists (default: '/')
 *
 * @example
 * ```tsx
 * // URL: /receive?redirectTo=/transactions/123
 * const { redirectTo } = useRedirectTo('/');
 * navigate(redirectTo); // navigates to '/transactions/123'
 * ```
 */
export const useRedirectTo = (defaultPath = '/') => {
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') ?? defaultPath;

  return { redirectTo };
};
