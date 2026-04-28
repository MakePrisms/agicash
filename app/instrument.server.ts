/**
 * Instruments the server code with Sentry.
 *
 * See https://docs.sentry.io/platforms/javascript/guides/react-router/#alternative-setup-for-hosting-platforms for more details.
 */
import * as os from 'node:os';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import * as Sentry from '@sentry/react-router';
import type { unstable_ServerInstrumentation } from 'react-router';
import { getEnvironment, isServedLocally } from './environment';
import { getTracesSampleRate, sanitizeUrl } from './tracing-utils';

/**
 * Docs for Sentry - React Router: https://docs.sentry.io/platforms/javascript/guides/react-router/
 * The docs are doing server instrumentation by defining instrument.server.mjs file which is then passed
 * as NODE_OPTIONS='--import ./instrument.server.mjs' when starting the dev or production server.
 * However, you can't do that when running on Vercel. See https://github.com/getsentry/sentry-javascript/discussions/16437
 * Thus we are using using React Router's new unstable implementation of instrumentation (https://reactrouter.com/how-to/instrumentation).
 * For the client instrumentation we still use the approach from the Sentry React Router docs.
 */
export const sentryInstrumentation: unstable_ServerInstrumentation = {
  handler(handler) {
    handler.instrument({
      async request(handleRequest, { request }) {
        const url = new URL(request.url);

        await Sentry.startSpan(
          {
            name: `${request.method} ${url.pathname}`,
            op: 'http.server',
            forceTransaction: true,
            attributes: {
              'http.method': request.method,
              'http.url': request.url,
              'http.target': url.pathname,
            },
          },
          async () => handleRequest(),
        );
      },
    });
  },

  route(route) {
    route.instrument({
      async loader(callLoader, { unstable_pattern }) {
        await Sentry.startSpan(
          {
            name: `loader ${route.id}`,
            op: 'function.react-router.loader',
            attributes: {
              'route.id': route.id,
              'route.pattern': unstable_pattern,
            },
          },
          () => callLoader(),
        );
      },

      async action(callAction, { unstable_pattern }) {
        await Sentry.startSpan(
          {
            name: `action ${route.id}`,
            op: 'function.react-router.action',
            attributes: {
              'route.id': route.id,
              'route.pattern': unstable_pattern,
            },
          },
          () => callAction(),
        );
      },

      async middleware(callMiddleware, { unstable_pattern }) {
        await Sentry.startSpan(
          {
            name: `middleware ${route.id}`,
            op: 'function.react-router.middleware',
            attributes: {
              'route.id': route.id,
              'route.pattern': unstable_pattern,
            },
          },
          () => callMiddleware(),
        );
      },
    });
  },
};

const hostname = os.hostname();

const networkInterfaces = os.networkInterfaces();
const ips = Object.values(networkInterfaces)
  .flat()
  .filter((iface) => iface?.family === 'IPv4' && !iface.internal)
  .map((iface) => iface?.address)
  .filter((x): x is string => Boolean(x));

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
    process.env.NODE_ENV === 'production' && !isServedLocally(hostname, ips),
  environment: getEnvironment(),
  enableLogs: true,
  normalizeDepth: 5,

  integrations: [
    Sentry.consoleLoggingIntegration(),
    nodeProfilingIntegration(),
    Sentry.extraErrorDataIntegration({ depth: 5 }),
  ],

  // Performance monitoring
  tracesSampleRate: sampleRate,
  profilesSampleRate: sampleRate,
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

    // HTTP server spans set description to "<METHOD> <pathname>" (e.g.
    // "POST /api/lnurlp/verify/<data>"). Sanitize URL-shaped descriptions
    // so path-pattern data doesn't leak via the rendered span name.
    const description = span.description;
    if (description && /^([A-Z]+ )?(\/|https?:\/\/)/.test(description)) {
      span.description = sanitizeUrl(description);
    }

    return span;
  },

  beforeSend(event) {
    // Filter out 4xx React Router errors (bots, crawlers, invalid requests)
    const serialized = event.extra?.__serialized__ as
      | { status?: number }
      | undefined;
    const status = serialized?.status;

    if (status !== undefined && status >= 400 && status < 500) {
      return null;
    }

    // Sanitize sensitive URL parts on the error event itself and on
    // breadcrumbs that capture outgoing HTTP / navigation URLs.
    if (event.request?.url) {
      event.request.url = sanitizeUrl(event.request.url);
    }
    for (const breadcrumb of event.breadcrumbs ?? []) {
      if (!breadcrumb.data) {
        continue;
      }
      if (typeof breadcrumb.data.to === 'string') {
        breadcrumb.data.to = sanitizeUrl(breadcrumb.data.to);
      }
      if (typeof breadcrumb.data.from === 'string') {
        breadcrumb.data.from = sanitizeUrl(breadcrumb.data.from);
      }
      if (typeof breadcrumb.data.url === 'string') {
        breadcrumb.data.url = sanitizeUrl(breadcrumb.data.url);
      }
    }

    return event;
  },
});
