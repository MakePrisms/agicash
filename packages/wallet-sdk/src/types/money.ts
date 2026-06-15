/**
 * Money / Currency value types — re-exported from the shared @agicash/money package.
 *
 * `Money` instances cross the SDK↔web boundary, so both sides must resolve to ONE
 * class (so `instanceof` holds). @agicash/money is the single source of truth; this
 * module re-exports it for the SDK's public surface. `events.ts` and `domains.ts`
 * import `Money`/`Currency` from here via `import type`, so they are unaffected.
 */
export { Money } from '@agicash/money';
export type { Currency, CurrencyUnit, UsdUnit, BtcUnit } from '@agicash/money';
