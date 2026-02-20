import { configure as configureCoreConfig } from '@agicash/core/config';
import { setMeasureOperation } from '@agicash/core/performance';
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
import { measureOperation as sentryMeasureOperation } from './lib/performance/sentry-performance';
import { getTracesSampleRate, sanitizeUrl } from './tracing-utils';

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

configureCoreConfig({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  cashuMintBlocklist: JSON.parse(
    import.meta.env.VITE_CASHU_MINT_BLOCKLIST ?? '[]',
  ),
  environment: getEnvironment(),
});

setMeasureOperation(sentryMeasureOperation);

const sentryDsn = import.meta.env.VITE_SENTRY_DSN ?? '';
if (!sentryDsn) {
  throw new Error('VITE_SENTRY_DSN is not set');
}

const sampleRate = getTracesSampleRate();

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

  integrations: [
    Sentry.consoleLoggingIntegration(),
    Sentry.reactRouterTracingIntegration(),
    Sentry.browserProfilingIntegration(),
    Sentry.extraErrorDataIntegration({ depth: 5 }),
  ],

  // Performance monitoring
  tracesSampleRate: sampleRate,
  profileSessionSampleRate: sampleRate,
  profileLifecycle: 'trace',

  // Sanitize sensitive URL parts before sending to Sentry
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
