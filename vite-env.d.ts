/// <reference types="vite/client" />

// biome-ignore lint/correctness/noUnusedVariables: this is needed to augment the ImportMetaEnv type
interface ViteTypeOptions {
  // By adding this line, you can make the type of ImportMetaEnv strict
  // to disallow unknown keys.
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined;
  readonly VITE_SUPABASE_ANON_KEY: string | undefined;
  readonly VITE_OPEN_SECRET_API_URL: string | undefined;
  readonly VITE_OPEN_SECRET_CLIENT_ID: string | undefined;
  readonly VITE_SENTRY_HOST: string | undefined;
  readonly VITE_SENTRY_PROJECT_ID: string | undefined;
  readonly VITE_SENTRY_DSN: string | undefined;
  readonly VITE_ENVIRONMENT: string | undefined;
  readonly VITE_LOCAL_DEV: string | undefined;
  // Feature flags
  readonly VITE_FF_GUEST_SIGNUP: string | undefined;
}

// biome-ignore lint/correctness/noUnusedVariables: this is needed to augment the ImportMeta type
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
