/// <reference types="vite/client" />

// Augment Intl.Locale with getWeekInfo (not yet in TypeScript's lib)
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale/getWeekInfo
declare namespace Intl {
  interface Locale {
    getWeekInfo?(): {
      firstDay: 1 | 2 | 3 | 4 | 5 | 6 | 7;
      weekend: number[];
    };
  }
}

// biome-ignore lint/correctness/noUnusedVariables: this is needed to augment the ImportMetaEnv type
interface ViteTypeOptions {
  // By adding this line, you can make the type of ImportMetaEnv strict
  // to disallow unknown keys.
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string | undefined;
  readonly VITE_OPEN_SECRET_API_URL: string | undefined;
  readonly VITE_OPEN_SECRET_CLIENT_ID: string | undefined;
  readonly VITE_SENTRY_HOST: string | undefined;
  readonly VITE_SENTRY_PROJECT_ID: string | undefined;
  readonly VITE_SENTRY_DSN: string | undefined;
  readonly VITE_ENVIRONMENT: string | undefined;
  readonly VITE_LOCAL_DEV: string | undefined;
  readonly VITE_CASHU_MINT_BLOCKLIST: string | undefined;
  readonly VITE_GIFT_CARDS: string | undefined;
}

// biome-ignore lint/correctness/noUnusedVariables: this is needed to augment the ImportMeta type
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
