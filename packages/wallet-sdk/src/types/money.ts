/**
 * Money / Currency value types — §1 + §12 of the contract.
 *
 * Slice 0 resolves PR1's `Money` placeholder: this module now re-exports the REAL
 * `Money` value object (a runtime class, not a `declare class` shell) so the SDK's
 * domain types can both reference it as a type AND target it with `z.instanceof(Money)`
 * at runtime — and so a consumer can `import { Money } from '@agicash/wallet-sdk'`.
 *
 * SOURCE OF TRUTH. The canonical `Money` (+ `Currency` / `CurrencyUnit`) lives in
 * `apps/web-wallet/app/lib/money` (`{ index, money, types }.ts`; leaf + dependency-free
 * apart from `big.js`). Per the build plan (§0.2) the SDK owns `Money` and the web app
 * imports it from this package; the canonical relocation of the source files INTO this
 * package + the rewrite of web's ~76 `~/lib/money` import sites is a deliberately-deferred
 * follow-up (out of the SDK build-plan scope). Until then this module re-exports the
 * single live source via a relative path so there is exactly ONE `Money` implementation
 * (no duplication, no web churn).
 *
 * NOTE on `lib: ["DOM"]`: `money.ts` ships a dev-only `registerDevToolsFormatter()` that
 * touches `window`; the SDK is a browser consumer (the web wallet), so the package
 * tsconfig includes the `DOM` lib. The formatter is never invoked by SDK code.
 *
 * TODO(follow-up): move `app/lib/money/**` into `packages/wallet-sdk/src/money/` and
 * rewire web's `~/lib/money` imports to `@agicash/wallet-sdk`; then this re-export
 * becomes a local `./money` re-export.
 */

export { Money } from '../../../../apps/web-wallet/app/lib/money';
export type {
  Currency,
  CurrencyUnit,
} from '../../../../apps/web-wallet/app/lib/money';

/**
 * Unit sub-types for `CurrencyUnit`. Kept here (the contract's `money.ts` surface)
 * because the canonical `app/lib/money/types.ts` does not export them by name and the
 * SDK contract (PR1) lists them on the public barrel. They are structurally identical
 * to the `UsdUnit` / `BtcUnit` the canonical `CurrencyUnit<T>` is built from.
 */
/** Denomination units for USD amounts. */
export type UsdUnit = 'usd' | 'cent';
/** Denomination units for BTC amounts. */
export type BtcUnit = 'btc' | 'sat' | 'msat';
