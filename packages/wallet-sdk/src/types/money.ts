// Money + Currency — domain value types

export type Currency = 'BTC' | 'USD';

/**
 * Money is an opaque value type (master uses a class).
 * Declared as an abstract class so TS treats it as a nominal type
 * (not structurally assignable from a plain object).
 */
export declare abstract class Money {
  abstract readonly amount: number;
  abstract readonly currency: Currency;
  abstract toString(): string;

  static sats(n: number): Money;
  static usd(cents: number): Money;
  static zero(currency: Currency): Money;
}
