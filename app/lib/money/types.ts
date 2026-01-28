import type { Big } from 'big.js';

export type NumberInput = number | string | Big;

declare global {
  /**
   * Extend this interface to add type-safe custom currencies.
   *
   * Example:
   * ```typescript
   * declare global {
   *   interface CustomCurrencies {
   *     EUR: { units: 'eur' | 'cent' };
   *   }
   * }
   * ```
   */
  interface CustomCurrencies {
    // Apps will augment this interface with their custom currencies
  }
}

/** Built-in currencies with full type support */
export type KnownCurrency = 'USD' | 'BTC';

/** All supported currencies: known currencies, custom currencies, and runtime strings */
export type Currency = KnownCurrency | keyof CustomCurrencies | (string & {});

export type UsdUnit = 'usd' | 'cent';
export type BtcUnit = 'btc' | 'sat' | 'msat';

type KnownCurrencyUnit<T extends KnownCurrency> = T extends 'USD'
  ? UsdUnit
  : T extends 'BTC'
    ? BtcUnit
    : never;

/** Unit to denominate the given currency */
export type CurrencyUnit<T extends Currency = Currency> =
  T extends KnownCurrency
    ? KnownCurrencyUnit<T>
    : T extends keyof CustomCurrencies
      ? CustomCurrencies[T] extends { units: infer U }
        ? U
        : string
      : string;

export type MoneyInput<T extends Currency = Currency> = {
  /**
   * Money amount
   */
  amount: NumberInput;
  /**
   * Currency for the provided amount of money
   */
  currency: T;
  /**
   * Unit of currency to use. For example for USD it can be 'usd' or 'cent', for BTC 'btc', 'sat' or 'msat', etc.
   * If not provided the default/base unit is used (bitcoin for BTC, dollar for USD, etc.)
   */
  unit?: CurrencyUnit<T>;
};

export type FormatOptions = {
  locale?: string;
  currency?: Currency;
  minimumFractionDigits?: number | 'max';
};

export type UnitData<T extends Currency> = {
  name: CurrencyUnit<T>;
  decimals: number;
  symbol: string;
  factor: Big;
  formatToParts: (
    value: number,
    options?: FormatOptions,
  ) => Intl.NumberFormatPart[];
  format: (value: number, options?: FormatOptions) => string;
};

export type CurrencyData<T extends Currency> = {
  baseUnit: CurrencyUnit<T>;
  units: Array<UnitData<T>>;
};

export type BaseFormatOptions = FormatOptions & {
  minimumFractionDigits?: number | 'max';
  maximumFractionDigits: number;
};

export type MoneyData<T extends Currency> = {
  /**
   * Currency of the money
   */
  currency: T;
  /**
   * Amount of the money stored in the `unit` format
   */
  amount: Big;
  /**
   * Unit in which the `amount` is stored. It is always the minimal supported unit for the `currency` (e.g. millisatoshi
   * for BTC)
   */
  amountUnit: UnitData<T>;
  /**
   * Unit of the initial amount that was provided when creating the money
   */
  initialUnit: UnitData<T>;
};

export type CurrencyDataMap = {
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic currency support requires any
  [key: string]: CurrencyData<any>;
};

export interface LocalizedStringParts {
  /** The complete formatted string including currency symbol */
  fullValue: string;
  /** The integer portion of the value. Includes the group separator. For example, '1,234' in $1,234.56 */
  integer: string;
  /**
   * The group separator. For example, ',' in $1,234.56
   * Will be empty string if the formatted value does not have a group separator.
   */
  groupSeparator: string;
  /** The fractional portion of the value. For example, '56' in $1,234.56 */
  fraction: string;
  /** The number of decimal places */
  numberOfDecimals: number;
  /**
   * The decimal separator. For example, '.' in $1,234.56
   * Will be empty string if the formatted value does not have a decimal separator.
   */
  decimalSeparator: string;
  /** The currency symbol */
  currencySymbol: string;
  /** Whether the currency symbol appears at the start or end */
  currencySymbolPosition: 'prefix' | 'suffix';
}

/**
 * Partial unit data for configuration (functions optional for overrides)
 */
export type PartialUnitData<T extends Currency> = {
  name: CurrencyUnit<T>;
  decimals?: number;
  symbol?: string;
  factor?: Big;
  formatToParts?: (
    value: number,
    options?: FormatOptions,
  ) => Intl.NumberFormatPart[];
  format?: (value: number, options?: FormatOptions) => string;
};

/**
 * Complete unit data (all fields required for new units)
 */
export type CompleteUnitData<T extends Currency> = {
  name: CurrencyUnit<T>;
  decimals: number;
  symbol: string;
  factor: Big;
  formatToParts: (
    value: number,
    options?: FormatOptions,
  ) => Intl.NumberFormatPart[];
  format: (value: number, options?: FormatOptions) => string;
};

/**
 * Partial currency data for configuration
 */
export type PartialCurrencyData<T extends Currency> = {
  baseUnit?: CurrencyUnit<T>;
  units?: Array<PartialUnitData<T>>;
};

/**
 * Complete currency data (all fields required for new currencies)
 */
export type CompleteCurrencyData<T extends Currency> = {
  baseUnit: CurrencyUnit<T>;
  units: Array<CompleteUnitData<T>>;
};

/**
 * Configuration for Money class
 */
export type MoneyConfiguration = {
  currencies?: {
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic currency support requires any
    [key: string]: PartialCurrencyData<any>;
  };
};
