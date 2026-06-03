/**
 * Money / Currency value types.
 *
 * PR1 (contract-as-code) ships these as standalone placeholders so the contract
 * typechecks with no runtime dependencies. `Money` is declared as an opaque class
 * shell (no method bodies) — the public domain types only ever reference it as a
 * type, never construct it here.
 *
 * TODO(Slice-0): replace this module with a re-export of the real `Money`
 * (+ `Currency`, `CurrencyUnit`) lifted from `app/lib/money/{index,money,types}.ts`
 * (verbatim; leaf + dependency-free). Web then imports `Money` from this package.
 * Source of truth: app/lib/money/types.ts (Currency/CurrencyUnit) + money.ts (Money).
 */

/** supported currencies — verbatim from app/lib/money/types.ts */
export type Currency = 'USD' | 'BTC';

/** Denomination units for USD amounts. */
export type UsdUnit = 'usd' | 'cent';
/** Denomination units for BTC amounts. */
export type BtcUnit = 'btc' | 'sat' | 'msat';

/** Unit to denominate the given currency — verbatim from app/lib/money/types.ts */
export type CurrencyUnit<T extends Currency = Currency> = T extends 'USD'
  ? UsdUnit
  : T extends 'BTC'
    ? BtcUnit
    : never;

/**
 * Opaque placeholder for the real `Money` value object.
 *
 * Declared as a class so domain types can use `Money` as both a type and (later)
 * a `z.instanceof(Money)` target without churn. No logic lives here in PR1.
 *
 * TODO(Slice-0): delete and re-export the real `Money` from `app/lib/money`.
 */
export declare class Money<T extends Currency = Currency> {
  /** Brand to keep the placeholder nominal (prevents structural collapse to `{}`). */
  private readonly __moneyBrand: T;
}
