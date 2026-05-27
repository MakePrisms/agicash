function getProductionDeploymentUrl(): string | undefined {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : undefined;
}

function getPreviewDeploymentUrl(): string | undefined {
  const host = process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : undefined;
}

/**
 * Origin for absolute URLs that external services must fetch (OG/Twitter
 * images, `og:url`). Prefers Vercel's deployment URL over the request origin
 * because at build-time prerender (`/home`, `/terms`) react-router uses
 * `http://localhost`, which gets frozen into the static HTML and is
 * unreachable by crawlers. Precedence mirrors Next.js's metadataBase fallback.
 * @see https://github.com/vercel/next.js/pull/65089
 * @param requestOrigin used outside Vercel (local dev / non-Vercel SSR).
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
