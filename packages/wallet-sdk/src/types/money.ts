/**
 * Money / Currency value types — §1 + §12 of the contract.
 *
 * Resolves the reactive base's `Money` placeholder: this module now re-exports the REAL
 * `Money` value object (a runtime class, not a `declare class` shell) so the SDK's domain
 * types can both reference it as a type AND target it at runtime (`Money.zero(...)`,
 * `new Money({ ... })`, the balance/comparison methods) — and so a consumer can
 * `import { Money } from '@agicash/wallet-sdk'`.
 *
 * Why now (Slice 2 / PR4): the prior reactive slices (auth + user) only ever referenced
 * `Money` as a TYPE, so a `declare`-shell sufficed. PR4 (accounts + scan) is the first
 * reactive slice that NEEDS the runtime `Money` — `account-balance` constructs it, and the
 * pure `suggestFor` ranking compares balances — so the shell is resolved to the real class
 * here. This matches the no-cache extraction's Slice 0 (same re-export) and the reactive
 * contract's "all domain types are unchanged — see the no-cache contract for the type defs".
 * Every prior reference was `import type`, so swapping the shell for the real value export is
 * non-breaking.
 *
 * SOURCE OF TRUTH. The canonical `Money` (+ `Currency` / `CurrencyUnit`) lives in
 * `apps/web-wallet/app/lib/money` (`{ index, money, types }.ts`; leaf + dependency-free
 * apart from `big.js`). Per the build plan the SDK owns `Money` and the web app imports it
 * from this package; the canonical relocation of the source files INTO this package + the
 * rewrite of web's `~/lib/money` import sites is a deliberately-deferred follow-up (out of
 * the SDK build-plan scope). Until then this module re-exports the single live source via a
 * relative path so there is exactly ONE `Money` implementation (no duplication, no web
 * churn).
 *
 * NOTE on `lib: ["DOM"]`: `money.ts` ships a dev-only `registerDevToolsFormatter()` that
 * touches `window`; the SDK is a browser consumer (the web wallet), so the package tsconfig
 * already includes the `DOM` lib. The formatter is never invoked by SDK code.
 *
 * TODO(follow-up): move `app/lib/money/**` into `packages/wallet-sdk/src/money/` and rewire
 * web's `~/lib/money` imports to `@agicash/wallet-sdk`; then this re-export becomes a local
 * `./money` re-export.
 */

export { Money } from '../../../../apps/web-wallet/app/lib/money';
export type {
  Currency,
  CurrencyUnit,
} from '../../../../apps/web-wallet/app/lib/money';

/**
 * Unit sub-types for `CurrencyUnit`. Kept here (the contract's `money.ts` surface) because
 * the canonical `app/lib/money/types.ts` does not export them by name and the SDK contract
 * lists them on the public barrel. They are structurally identical to the `UsdUnit` /
 * `BtcUnit` the canonical `CurrencyUnit<T>` is built from.
 */
/** Denomination units for USD amounts. */
export type UsdUnit = 'usd' | 'cent';
/** Denomination units for BTC amounts. */
export type BtcUnit = 'btc' | 'sat' | 'msat';
