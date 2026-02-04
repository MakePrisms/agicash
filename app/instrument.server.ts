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

function sanitizeUrl(url: string): string {
  const uuidRegex =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  return url.replace(uuidRegex, ':id');
}

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
        const sanitizedPath = sanitizeUrl(url.pathname);

        await Sentry.startSpan(
          {
            name: `${request.method} ${sanitizedPath}`,
            op: 'http.server',
            forceTransaction: true,
            attributes: {
              'http.method': request.method,
              'http.url': sanitizeUrl(request.url),
              'http.target': sanitizedPath,
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

Sentry.init({
  dsn: sentryDsn,
  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/react-router/configuration/options/#sendDefaultPii
  sendDefaultPii: false,
  enabled:
    process.env.NODE_ENV === 'production' && !isServedLocally(hostname, ips),
  environment: getEnvironment(),
  enableLogs: true,
  integrations: [
    Sentry.consoleLoggingIntegration(),
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});
