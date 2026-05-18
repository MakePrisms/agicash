/**
 * Paths prerendered at build time. Consumed by `react-router.config.ts`
 * (the actual prerender directive) and `app/entry.server.tsx` (where the
 * list is used to disable React's Suspense outlining for runtime SSR of
 * these routes — Vercel currently doesn't serve them as static files when
 * `ssr:true`, see remix-run/react-router#14281).
 */
export const PRERENDERED_PATHS = [
  '/terms',
  '/terms/wallet',
  '/terms/mint',
  '/privacy',
  '/privacy/wallet',
  '/privacy/mint',
  '/mint-risks',
  '/home',
];
