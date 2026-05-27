function getProductionDeploymentUrl(): string | undefined {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : undefined;
}

function getPreviewDeploymentUrl(): string | undefined {
  const host = process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : undefined;
}

/**
 * The site's reachable origin, for absolute URLs that leave the app — OG/Twitter
 * images, shared token links, profile URLs, `username@domain` Lightning
 * Addresses. On Vercel it returns the production domain (or the branch/deploy
 * URL on preview); elsewhere it falls back to the request origin. We avoid the
 * request origin because at build-time prerender (`/home`, `/terms`) react-router
 * uses `http://localhost`, which is frozen into the static HTML and — since the
 * root loader never revalidates — served for the whole session. Precedence
 * mirrors Next.js's metadataBase fallback.
 * @see https://github.com/vercel/next.js/pull/65089
 * @param requestOrigin fallback used off Vercel (local dev / non-Vercel SSR).
 */
export function getCanonicalOrigin(requestOrigin: string): string {
  if (process.env.VERCEL_ENV === 'preview') {
    return getPreviewDeploymentUrl() ?? requestOrigin;
  }
  if (process.env.VERCEL_ENV === 'production') {
    return getProductionDeploymentUrl() ?? requestOrigin;
  }
  return requestOrigin;
}
