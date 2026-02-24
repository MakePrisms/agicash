import { useSearchParams } from 'react-router';

type PathWithSearch = { pathname: string; search: string };

/**
 * Returns a function that creates navigation targets preserving all current search params.
 *
 * Use this when navigating between steps in a flow to maintain search params
 * (like `redirectTo`, `accountId`, etc.) throughout the entire flow.
 *
 * @example
 * ```tsx
 * const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
 *
 * // Current URL: /receive?redirectTo=/home&amount=100
 * const to = buildLinkWithSearchParams('/receive/confirm', { step: '2' });
 * // Result: { pathname: '/receive/confirm', search: 'redirectTo=/home&amount=100&step=2' }
 * ```
 */
export const useBuildLinkWithSearchParams = () => {
  const [searchParams] = useSearchParams();

  return (pathname: string, extra?: Record<string, string>): PathWithSearch => {
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
};
