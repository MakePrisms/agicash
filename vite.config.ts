import { reactRouter } from '@react-router/dev/vite';
import {
  type SentryReactRouterBuildOptions,
  sentryReactRouter,
} from '@sentry/react-router';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import tsconfigPaths from 'vite-tsconfig-paths';
import { JsonGiftCardConfigSchema } from './app/features/gift-cards/gift-card-config';
import { JsonMintDescriptionMapSchema } from './app/features/send/mint-description-config';

const sentryConfig: SentryReactRouterBuildOptions = {
  org: 'make-prisms',
  project: 'agicash',
  // An auth token is required for uploading source maps.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  unstable_sentryVitePluginOptions: {
    applicationKey: 'agicash',
  },
};

function validateEnv(mode: string) {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (env.VITE_GIFT_CARDS) {
    JsonGiftCardConfigSchema.parse(env.VITE_GIFT_CARDS);
  }
  if (env.VITE_MINT_DESCRIPTION_MAP) {
    JsonMintDescriptionMapSchema.parse(env.VITE_MINT_DESCRIPTION_MAP);
  }
}

export default defineConfig((config) => {
  validateEnv(config.mode);

  const isDev = config.command === 'serve';

  return {
    plugins: [
      tailwindcss(),
      reactRouter(),
      tsconfigPaths(),
      devtoolsJson(),
      // We don't want to upload source maps to Sentry when building locally.
      process.env.VERCEL ? sentryReactRouter(sentryConfig, config) : null,
    ].filter((plugin) => Boolean(plugin)),
    server: isDev
      ? {
          // allow webhook deliveries from pg_net inside the supabase_db
          // container, which reaches the host dev server via
          // host.docker.internal
          allowedHosts: ['host.docker.internal'],
        }
      : undefined,
    // Exclude from pre-bundling so libraries' internal relative URLs resolve correctly.
    // Pre-bundling inlines a library into a single file under .vite/deps/, breaking
    // `new URL('./file', import.meta.url)` patterns used to load Web Workers and WASM.
    // - @agicash/qr-scanner: loads a Web Worker via relative URL
    // - @agicash/breez-sdk-spark: loads breez_sdk_spark_wasm_bg.wasm via relative URL
    // Trade-off: the browser makes a few extra HTTP requests in dev. No impact on production.
    optimizeDeps: {
      exclude: ['@agicash/qr-scanner', '@agicash/breez-sdk-spark'],
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
  };
});
