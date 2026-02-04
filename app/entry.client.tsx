import { configure } from '@opensecret/react';
/**
 * By default, React Router  will handle hydrating your app on the client for you.
 * You are free to delete this file if you'd like to, but if you ever want it revealed again, you can run `npx react-router reveal` ✨
 * For more information, see https://reactrouter.com/explanation/special-files#entryclienttsx
 */
import * as Sentry from '@sentry/react-router';
import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';
import { getEnvironment, isServedLocally } from './environment';
import { Money } from './lib/money';
import { getTracesSampleRate, sanitizeUrl } from './lib/sentry';

// Register Chrome DevTools custom formatter for Money class (dev only)
if (process.env.NODE_ENV === 'development') {
  Money.registerDevToolsFormatter();
}

const openSecretApiUrl = import.meta.env.VITE_OPEN_SECRET_API_URL ?? '';
if (!openSecretApiUrl) {
  throw new Error('VITE_OPEN_SECRET_API_URL is not set');
}

const openSecretClientId = import.meta.env.VITE_OPEN_SECRET_CLIENT_ID ?? '';
if (!openSecretClientId) {
  throw new Error('VITE_OPEN_SECRET_CLIENT_ID is not set');
}

configure({
  apiUrl: openSecretApiUrl,
  clientId: openSecretClientId,
});

const sentryDsn = import.meta.env.VITE_SENTRY_DSN ?? '';
if (!sentryDsn) {
  throw new Error('VITE_SENTRY_DSN is not set');
}

Sentry.init({
  dsn: sentryDsn,
  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/react-router/configuration/options/#sendDefaultPii
  sendDefaultPii: false,
  enabled:
    process.env.NODE_ENV === 'production' &&
    !isServedLocally(window.location.hostname),
  environment: getEnvironment(),
  tunnel: '/api/logs',
  enableLogs: true,

  // Performance monitoring
  tracesSampleRate: getTracesSampleRate(),

  integrations: [
    Sentry.consoleLoggingIntegration(),
    Sentry.reactRouterTracingIntegration(),
  ],

  // Sanitize sensitive URL parameters before sending to Sentry
  beforeSendSpan(span) {
    const url = span.data?.['http.url'] || span.data?.url;
    if (typeof url === 'string') {
      const sanitizedUrl = sanitizeUrl(url);
      span.data['http.url'] = sanitizedUrl;
      if (span.data.url) {
        span.data.url = sanitizedUrl;
      }
    }
    return span;
  },
});

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
