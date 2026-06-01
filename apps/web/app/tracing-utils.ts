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
 * Sanitizes URLs to remove sensitive path parameters, query param values, and URL
 * fragments (hashes) before sending to tracing/analytics platforms. This prevents
 * quote IDs, verification codes, cashu tokens, and other sensitive data from being
 * logged.
 */
export function sanitizeUrl(url: string): string {
  // Redact URL fragment (hash) since it can contain sensitive data such as
  // cashu tokens, but keep the "#<redacted>" marker so it stays visible that
  // a fragment was present.
  const hashIndex = url.indexOf('#');
  const beforeFragment = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const fragmentSuffix =
    hashIndex !== -1 && hashIndex < url.length - 1 ? '#<redacted>' : '';

  // Separate path from query string
  const [path, queryString] = beforeFragment.split('?');

  // Sanitize path segments
  const sanitizedPath = path
    // Cashu melt quote: /melt/quote/{method}/{quote_id}
    .replace(/(\/melt\/quote\/[^/]+)\/[^/?]+/, '$1/<quote-id>')
    // Cashu mint quote: /mint/quote/{method}/{quote_id}
    .replace(/(\/mint\/quote\/[^/]+)\/[^/?]+/, '$1/<quote-id>')
    // Email verification: /verify-email/{code}
    .replace(/\/verify-email\/[^/?]+/, '/verify-email/<code>')
    // LNURL-pay verify: /api/lnurlp/verify/{encrypted_quote_data}
    .replace(/\/api\/lnurlp\/verify\/[^/?]+/, '/api/lnurlp/verify/<data>');

  // Redact query param values while preserving param names
  if (!queryString) {
    return `${sanitizedPath}${fragmentSuffix}`;
  }

  const sanitizedQuery = queryString
    .split('&')
    .map((param) => {
      const eqIndex = param.indexOf('=');
      if (eqIndex === -1) {
        return param; // No value, keep as-is
      }
      const key = param.substring(0, eqIndex);
      return `${key}=<redacted>`;
    })
    .join('&');

  return `${sanitizedPath}?${sanitizedQuery}${fragmentSuffix}`;
}
