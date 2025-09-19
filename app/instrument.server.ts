/**
 * Instruments the server code with Sentry.
 *
 * See https://docs.sentry.io/platforms/javascript/guides/react-router/#alternative-setup-for-hosting-platforms for more details.
 */
import * as os from 'node:os';
import * as Sentry from '@sentry/react-router';
import { getEnvironment, isServedLocally } from './environment';

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
  integrations: [Sentry.consoleLoggingIntegration()],
});
