import { getEnvironment } from '~/environment';

/**
 * Returns the traces sample rate based on the current environment.
 * Production uses lower sampling to control costs while still providing visibility.
 */
export function getTracesSampleRate(): number {
  const env = getEnvironment();
  // if (env === 'production') return 0.1; // 10%
  // For now we will keep production at 100% too.
  if (env === 'production') return 1.0; // 100%
  if (env === 'next') return 0.5; // 50%
  if (env === 'preview') return 1.0; // 100%
  return 0; // local - no tracing
}

/**
 * Sanitizes URLs to remove sensitive path parameters before sending to Sentry.
 * This prevents quote IDs, verification codes, and other sensitive data from being logged.
 */
export function sanitizeUrl(url: string): string {
  return (
    url
      // Cashu melt quote: /melt/quote/{method}/{quote_id}
      .replace(/(\/melt\/quote\/[^/]+)\/[^/?]+/, '$1/<quote-id>')
      // Cashu mint quote: /mint/quote/{method}/{quote_id}
      .replace(/(\/mint\/quote\/[^/]+)\/[^/?]+/, '$1/<quote-id>')
      // Email verification: /verify-email/{code}
      .replace(/\/verify-email\/[^/?]+/, '/verify-email/<code>')
      // LNURL-pay verify: /api/lnurlp/verify/{encrypted_quote_data}
      .replace(/\/api\/lnurlp\/verify\/[^/?]+/, '/api/lnurlp/verify/<data>')
  );
}
