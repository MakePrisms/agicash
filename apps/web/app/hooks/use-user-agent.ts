import { useRouteLoaderData } from 'react-router';

export type Browser =
  | 'SamsungBrowser'
  | 'Firefox'
  | 'FirefoxiOS'
  | 'ChromeiOS'
  | 'Chrome'
  | 'Safari'
  | 'unknown';

/**
 * This hook uses the root loader data to get the user agent string and from there determine
 * the browser, if the user is on a mobile device, and if the user is on iOS.
 *
 * @example
 * ```tsx
 * const { isMobile, browser, userAgentString, isIOS } = useUserAgent();
 * ```
 */
export default function useUserAgent() {
  const { userAgentString } = useRouteLoaderData('root') as {
    userAgentString: string;
  };

  /**
   * Parse user agent string to determine browser
   * The order of the if statements is important because some browsers
   * have multiple matches in their user agent string
   */
  let browser: Browser;
  if (userAgentString.indexOf('SamsungBrowser') > -1) {
    browser = 'SamsungBrowser';
  } else if (userAgentString.indexOf('Firefox') > -1) {
    browser = 'Firefox';
  } else if (userAgentString.indexOf('FxiOS') > -1) {
    browser = 'FirefoxiOS';
  } else if (userAgentString.indexOf('CriOS') > -1) {
    browser = 'ChromeiOS';
  } else if (userAgentString.indexOf('Chrome') > -1) {
    browser = 'Chrome';
  } else if (userAgentString.indexOf('Safari') > -1) {
    browser = 'Safari';
  } else {
    browser = 'unknown';
  }

  // Check if user agent is mobile
  const isIOS = !!userAgentString.match(/iPhone|iPad|iPod/i);
  const isAndroid = !!userAgentString.match(/Android/i);
  const isMobile = isIOS || isAndroid;

  return { isMobile, browser, userAgentString, isIOS };
}
