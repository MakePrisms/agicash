/**
 * SDK-internal long-timeout + set helpers — Slice 3 / PR5d (the mint-WS subscription managers).
 *
 * The lifted mint-quote / melt-quote subscription managers (and the expiry timers the orchestrator
 * schedules) need two framework-free utilities master keeps in `app/lib`:
 *  - `setLongTimeout` / `clearLongTimeout` (`app/lib/timeout.ts`) — a `setTimeout` that supports
 *    delays beyond the ~24.8-day platform cap (a quote can have a far-future expiry);
 *  - `isSubset` (`app/lib/utils.ts`) — the subscription manager's "is this quote-id set already
 *    covered?" check.
 *
 * Both are pure (no react / @tanstack), so per the package's single-source seam (see `./lib-cashu`)
 * they are re-exported from the live app source rather than copied.
 *
 * @module
 */

export {
  type LongTimeout,
  clearLongTimeout,
  setLongTimeout,
} from '../../../../apps/web-wallet/app/lib/timeout';
export { isSubset } from '../../../../apps/web-wallet/app/lib/utils';
