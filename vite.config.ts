import { reactRouter } from '@react-router/dev/vite';
import {
  type SentryReactRouterBuildOptions,
  sentryReactRouter,
} from '@sentry/react-router';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import tsconfigPaths from 'vite-tsconfig-paths';

const sentryConfig: SentryReactRouterBuildOptions = {
  org: 'make-prisms',
  project: 'agicash',
  // An auth token is required for uploading source maps.
  authToken: process.env.SENTRY_AUTH_TOKEN,
};

export default defineConfig((config) => ({
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
    devtoolsJson(),
    // We don't want to upload source maps to Sentry when building locally.
    process.env.VERCEL ? sentryReactRouter(sentryConfig, config) : null,
  ].filter((plugin) => Boolean(plugin)),
  // Exclude from pre-bundling so the library's internal `new URL('./worker.js', import.meta.url)`
  // resolves correctly. Pre-bundling inlines the library into a single file, breaking the
  // relative URL used to load the Web Worker.
  // Trade-off: the browser makes a few extra HTTP requests in dev for this library's modules
  // instead of one pre-bundled file. Negligible for a small library. No impact on production.
  optimizeDeps: {
    exclude: ['@agicash/qr-scanner'],
  },
  build: {
    emptyOutDir: false,
    rollupOptions: {
      // See https://github.com/vitejs/vite/issues/15012#issuecomment-1948550039
      onwarn(warning, defaultHandler) {
        if (warning.code === 'SOURCEMAP_ERROR') {
          return;
        }

        defaultHandler(warning);
      },
    },
  },
}));
