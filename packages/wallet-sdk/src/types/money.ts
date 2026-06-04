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
 * SOURCE OF TRUTH. The canonical `Money` (+ `Currency` / `CurrencyUnit`) lives in the shared
 * leaf package `@agicash/lib` (`packages/lib/src/money`; framework-free, depending only on
 * `big.js`). It is a pure cross-cutting primitive used by BOTH the web app and this SDK
 * independently of any wallet-domain concern, so it lives at the bottom of the dep graph in
 * `@agicash/lib` rather than inside the SDK (which would couple the web UI to the wallet SDK
 * just to format a `Money`). This module re-exports that single live source so there is
 * exactly ONE `Money` implementation and a consumer can `import { Money } from
 * '@agicash/wallet-sdk'`.
 *
 * NOTE on `lib: ["DOM"]`: `money.ts` ships a dev-only `registerDevToolsFormatter()` that
 * touches `window`; the SDK is a browser consumer (the web wallet), so the package tsconfig
 * already includes the `DOM` lib. The formatter is never invoked by SDK code.
 */

export { Money } from '@agicash/lib';
export type { Currency, CurrencyUnit } from '@agicash/lib';

/**
 * Unit sub-types for `CurrencyUnit`. Kept here (the contract's `money.ts` surface) because
 * the canonical `@agicash/lib` money types do not export them by name and the SDK contract
 * lists them on the public barrel. They are structurally identical to the `UsdUnit` /
 * `BtcUnit` the canonical `CurrencyUnit<T>` is built from.
 */
/** Denomination units for USD amounts. */
export type UsdUnit = 'usd' | 'cent';
/** Denomination units for BTC amounts. */
export type BtcUnit = 'btc' | 'sat' | 'msat';
