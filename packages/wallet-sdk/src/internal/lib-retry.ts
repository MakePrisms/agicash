/**
 * SDK-internal retry helper — Slice 3 / PR5d (the orchestrator's drive loop).
 *
 * The orchestrator re-houses master's six React-resident `useProcess*Tasks` hooks off
 * `@tanstack/react-query`. The TanStack mutations got retry/backoff "for free" from
 * React Query (`useMutation({ retry, retryDelay })`); the framework-free orchestrator needs an
 * equivalent. Master already ships exactly such a helper at `app/lib/with-retry.ts` — a pure,
 * framework-free `withRetry({ fn, retry, retryDelay, signal })` with exponential backoff. Per the
 * build plan (§3, "use `with-retry.ts` helper"), it is lifted here.
 *
 * Following the package's established single-source seam (see `./lib-cashu` / `./lib-scan`), this
 * re-exports the SINGLE live source via a relative path rather than copying it — `with-retry.ts`
 * (and its `delay` dependency) import nothing framework-coupled (verified: only a `setTimeout`
 * delay + `AbortSignal`). The canonical relocation of `app/lib/**` INTO the package is a deferred
 * follow-up (out of the build-plan's scope).
 *
 * @module
 */

export { withRetry } from '../../../../apps/web-wallet/app/lib/with-retry';
