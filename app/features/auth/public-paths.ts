/**
 * Single source of truth for routes that don't require authentication.
 *
 * Derived from `app/routes/`: anything not under `_protected.*` is public.
 * The `_auth.*` routes (login/signup/etc.) are public because logged-out users
 * are the primary audience. Server endpoints under `/api/` and `/.well-known/`
 * are also public — they're hit programmatically, never go through
 * `_protected.tsx`, and any access checks they need are enforced server-side.
 */
export const PUBLIC_PATH_PREFIXES = [
  '/home',
  '/login',
  '/signup',
  '/forgot-password',
  '/oauth/',
  '/terms',
  '/privacy',
  '/mint-terms',
  '/mint-privacy',
  '/mint-risks',
  '/receive-cashu-token',
  '/.well-known/',
  '/api/',
  '/manifest.webmanifest',
];

export const isPublicPath = (path: string): boolean =>
  PUBLIC_PATH_PREFIXES.some((prefix) =>
    prefix.endsWith('/')
      ? path.startsWith(prefix)
      : path === prefix || path.startsWith(`${prefix}/`),
  );
