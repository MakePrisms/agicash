import { Big } from 'big.js';
import type {
  BaseFormatOptions,
  Currency,
  CurrencyData,
  CurrencyDataMap,
  CurrencyUnit,
  FormatOptions,
  LocalizedStringParts,
  MoneyData,
  MoneyInput,
  NumberInput,
  UnitData,
} from './types';

function getCurrencyFormatter(options: BaseFormatOptions) {
  const { locale, minimumFractionDigits, maximumFractionDigits, currency } =
    options;
  const formatOptions: Parameters<typeof Intl.NumberFormat>[1] = {
    minimumFractionDigits:
      minimumFractionDigits === 'max'
        ? maximumFractionDigits
        : minimumFractionDigits,
    maximumFractionDigits,
  };
  if (currency) {
    formatOptions.style = 'currency';
    formatOptions.currency = currency;
    formatOptions.currencyDisplay = 'narrowSymbol';
  }
  return Intl.NumberFormat(locale, formatOptions);
}
const trimWhitespaceFromEnds = (
  parts: Intl.NumberFormatPart[],
): Intl.NumberFormatPart[] => {
  if (parts.length === 0) {
    return [];
  }

  let result = parts;

  const firstPart = result[0];
  if (firstPart.type === 'literal' && firstPart.value.trim() === '') {
    result = result.slice(1);
  }

  const lastPart = result[result.length - 1];
  if (lastPart.type === 'literal' && lastPart.value.trim() === '') {
    result = result.slice(0, -1);
  }

  return result;
};

const currencyDataMap: CurrencyDataMap = {
  USD: {
    baseUnit: 'usd',
    units: [
      {
        name: 'usd',
        decimals: 2,
        symbol: '$',
        factor: new Big(1),
        formatToParts: function (value: number, options: FormatOptions = {}) {
          const formatter = getCurrencyFormatter({
            ...options,
            maximumFractionDigits: this.decimals,
          });
          return formatter.formatToParts(value);
        },
        format: function (value: number, options: FormatOptions = {}) {
          const formatter = getCurrencyFormatter({
            ...options,
            maximumFractionDigits: this.decimals,
          });
          return formatter.format(value);
        },
      },
      {
        name: 'cent',
        decimals: 0,
        symbol: '¢',
        factor: new Big(10 ** -2),
        formatToParts: function (value: number, options: FormatOptions = {}) {
          const formatter = getCurrencyFormatter({
            ...options,
            maximumFractionDigits: this.decimals,
          });

          const parts = formatter.formatToParts(value);
          const partsWithoutSymbol = parts.filter(
            ({ type }) => type !== 'currency',
          );
          const trimmedPartsWithoutSymbol =
            trimWhitespaceFromEnds(partsWithoutSymbol);
          const partsWithNewSymbolAppended = [
            ...trimmedPartsWithoutSymbol,
            { type: 'currency' as const, value: this.symbol },
          ];

          return partsWithNewSymbolAppended;
        },
        format: function (value: number, options: FormatOptions = {}) {
          return this.formatToParts(value, options)
            .map(({ value }) => value)
            .join('');
        },
      },
    ],
  },
  BTC: {
    baseUnit: 'btc',
    units: [
      {
        name: 'btc',
        decimals: 8,
        symbol: '₿',
        factor: new Big(1),
        formatToParts: function (value: number, options: FormatOptions = {}) {
          const formatter = getCurrencyFormatter({
            ...options,
            maximumFractionDigits: this.decimals,
          });

          const parts = formatter.formatToParts(value);
          const partsWithoutSymbol = parts.filter(
            ({ type }) => type !== 'currency',
          );
          const trimmedPartsWithoutSymbol =
            trimWhitespaceFromEnds(partsWithoutSymbol);
          const partsWithNewSymbolPrepended = [
            { type: 'currency' as const, value: this.symbol },
            ...trimmedPartsWithoutSymbol,
          ];

          return partsWithNewSymbolPrepended;
        },
        format: function (value: number, options: FormatOptions = {}) {
          return this.formatToParts(value, options)
            .map(({ value }) => value)
            .join('');
        },
      },
      {
        name: 'sat',
        decimals: 0,
        symbol: '₿',
        factor: new Big(10 ** -8),
        formatToParts: function (value: number, options: FormatOptions = {}) {
          const formatter = getCurrencyFormatter({
            ...options,
            maximumFractionDigits: this.decimals,
          });

          const parts = formatter.formatToParts(value);
          const partsWithoutSymbol = parts.filter(
            ({ type }) => type !== 'currency',
          );
          const trimmedPartsWithoutSymbol =
            trimWhitespaceFromEnds(partsWithoutSymbol);
          const partsWithNewSymbolPrepended = [
            { type: 'currency' as const, value: this.symbol },
            ...trimmedPartsWithoutSymbol,
          ];

          return partsWithNewSymbolPrepended;
        },
        format: function (value: number, options: FormatOptions = {}) {
          return this.formatToParts(value, options)
            .map(({ value }) => value)
            .join('');
        },
      },
      {
        name: 'msat',
        decimals: 0,
        symbol: 'msat',
        factor: new Big(10 ** -11),
        formatToParts: function (value: number, options: FormatOptions = {}) {
          const formatter = getCurrencyFormatter({
            ...options,
            maximumFractionDigits: this.decimals,
          });

          const parts = formatter.formatToParts(value);
          const partsWithoutSymbol = parts.filter(
            ({ type }) => type !== 'currency',
          );
          const trimmedPartsWithoutSymbol =
            trimWhitespaceFromEnds(partsWithoutSymbol);
          const partsWithNewSymbolAppended = [
            ...trimmedPartsWithoutSymbol,
            { type: 'literal' as const, value: ' ' },
            { type: 'currency' as const, value: this.symbol },
          ];

          return partsWithNewSymbolAppended;
        },
        format: function (value: number, options: FormatOptions = {}) {
          return this.formatToParts(value, options)
            .map(({ value }) => value)
            .join('');
        },
      },
    ],
  },
};

const getCurrencyData = <T extends Currency>(currency: T) => {
  const currencyData = currencyDataMap[currency];
  if (!currencyData) {
    throw new Error(`Unsupported currency: ${currency}`);
  }
  return currencyData;
};

const getCurrencyBaseUnit = <T extends Currency>(currency: T) => {
  const currencyData = getCurrencyData(currency);
  const baseUnit = currencyData.units.find(
    (x) => x.name === currencyData.baseUnit,
  );
  if (!baseUnit) {
    throw new Error(`Misconfigured currency: ${currency}`);
  }
  return baseUnit;
};

const getCurrencyMinUnit = <T extends Currency>(currency: T) => {
  const currencyData = getCurrencyData(currency);
  const minUnit = currencyData.units.sort((a, b) => a.factor.cmp(b.factor))[0];
  if (!minUnit) {
    throw new Error(`Misconfigured currency: ${currency}`);
  }
  return minUnit;
};

export class Money<T extends Currency = Currency> {
  private readonly _data: MoneyData<T>;

  /**
   * Returns the class tag for better console output.
   * Shows as "Money" in Object.prototype.toString.call()
   */
  get [Symbol.toStringTag](): string {
    return 'Money';
  }

  /**
   * Returns a formatted string representation for debugging.
   * Visible when expanding the object in browser DevTools.
   */
  get formatted(): string {
    return this.toLocaleString();
  }

  /**
   * Custom inspect method for Node.js console output.
   * Shows formatted value instead of internal structure.
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `Money { ${this.toLocaleString()} }`;
  }

  /**
   * Registers a Chrome DevTools custom formatter for Money instances.
   * Call this once at app startup to enable pretty console output.
   *
   * To enable custom formatters in Chrome DevTools:
   * 1. Open DevTools (F12)
   * 2. Click Settings (gear icon) or press F1
   * 3. Under "Console", check "Custom formatters"
   *
   * After enabling, Money instances will display as: Money ₿1,234.00
   */
  static registerDevToolsFormatter(): void {
    if (typeof window === 'undefined') return;

    const formatter = {
      header: (obj: unknown) => {
        if (!(obj instanceof Money)) return null;
        return [
          'div',
          { style: 'font-weight: bold; color: #9c27b0;' },
          `Money ${obj.toLocaleString()}`,
        ];
      },
      hasBody: (obj: unknown) => obj instanceof Money,
      body: (obj: unknown) => {
        if (!(obj instanceof Money)) return null;
        const money = obj as Money;
        return [
          'div',
          { style: 'margin-left: 12px;' },
          [
            'div',
            {},
            ['span', { style: 'color: #888;' }, 'currency: '],
            money.currency,
          ],
          [
            'div',
            {},
            ['span', { style: 'color: #888;' }, 'amount: '],
            money.amount().toString(),
          ],
          [
            'div',
            {},
            ['span', { style: 'color: #888;' }, 'formatted: '],
            money.toLocaleString(),
          ],
        ];
      },
    };

    // @ts-expect-error - devtoolsFormatters is a non-standard Chrome API
    window.devtoolsFormatters = window.devtoolsFormatters || [];
    // @ts-expect-error - devtoolsFormatters is a non-standard Chrome API
    window.devtoolsFormatters.push(formatter);
  }

  constructor(data: MoneyInput<T>) {
    const { baseUnit, minUnit, selectedUnit } =
      Money.getCurrencyDataForInput<T>(data);
    const unit = selectedUnit ?? baseUnit;

    const multiplier = unit.factor.div(minUnit.factor);
    const amountInMinUnit = new Big(data.amount).mul(multiplier);

    this._data = {
      amount: amountInMinUnit.round(minUnit.decimals, Big.roundDown),
      currency: data.currency,
      amountUnit: minUnit,
      initialUnit: unit,
    };

    Object.freeze(this);
    Object.freeze(this._data);
  }

  /**
   * Sum an array of moneys.
   *
   * If the array is empty, a currency must be specified so that 0 can be returned in that currency.
   *
   * The precision, etc., is based on the first item in the array.
   */
  static sum<T extends Currency>(moneys: Money<T>[], currency?: T): Money<T> {
    if (moneys.length === 0 && currency === undefined) {
      throw new Error(
        "Currency must be set when summing an empty list of money's",
      );
    }

    if (moneys.length === 0 && currency !== undefined) {
      return new Money({ amount: 0, currency });
    }

    return moneys.slice(1).reduce((sum, money) => sum.add(money), moneys[0]);
  }

  static max<T extends Currency>(moneys: Money<T>[]): Money<T> {
    if (moneys.length === 0) {
      throw new Error('Need at least one money for comparison');
    }
    return moneys.reduce(
      (max, money) => (money.greaterThan(max) ? money : max),
      moneys[0],
    );
  }

  static min<T extends Currency>(moneys: Money<T>[]): Money<T> {
    if (moneys.length === 0) {
      throw new Error('Need at least one money for comparison');
    }
    return moneys.reduce(
      (min, money) => (money.lessThan(min) ? money : min),
      moneys[0],
    );
  }

  /**
   * Compare two money objects.
   *
   * 1 if money1 is greater than money2
   * 0 if equal
   * -1 if money1 is less than money2
   *
   * This can be plugged directly into array.sort(),
   * and it will cause the array to be sorted in ascending order.
   */
  static compare<T extends Currency>(
    money1: Money<T>,
    money2: Money<T>,
  ): number {
    money1.assertSameCurrency(money2);
    return money1.amount().cmp(money2.amount());
  }

  static zero(currency: Currency): Money {
    return new Money({ amount: 0, currency });
  }

  /**
   * Create a money object with the minimum amount for the given currency and unit.
   * @param currency The currency to create the money object for.
   * @param unit The unit to create the money object for. If not provided, the base unit for the currency is used.
   * @returns A money object with the minimum amount for the given currency and unit.
   */
  static createMinAmount<T extends Currency>(
    currency: T,
    unit?: CurrencyUnit<T>,
  ): Money<T> {
    const unitToUse = unit ?? getCurrencyMinUnit(currency).name;
    return new Money({ amount: 1, currency, unit: unitToUse });
  }

  get currency(): T {
    return this._data.currency;
  }

  /**
   * Returns the maximum number of decimals for the requested unit.
   * If no unit is provided, the maximum number of decimals for the base unit is returned.
   */
  getMaxDecimals(unit?: CurrencyUnit<T>): number {
    return this.getCurrencyUnit(unit).decimals;
  }

  /**
   * Returns the currency symbol for the requested unit
   * @param unit Unit of currency. Default value is base unit (e.g. btc or usd)
   */
  getCurrencySymbol(unit?: CurrencyUnit<T>): string {
    return this.getCurrencyUnit(unit).symbol;
  }

  /**
   * Gets the base unit name for the currency.
   * @returns The base unit name for the currency.
   */
  getBaseUnit = (): CurrencyUnit<T> => {
    return this.currencyData.baseUnit;
  };

  /**
   * Returns the money amount in the requested currency unit. If no unit is provided it uses the
   * default/base unit (bitcoin, dollar, ...).
   *
   * If the requested unit does not have enough precision the number will be rounded down to the number of decimals of
   * the requested unit. For example if the requested unit is 'btc' and the money instance has 4567 msat, the return
   * value will be 0.00000004
   *
   * @param unit The unit of the currency to use for the amount. Default is base currency unit (bitcoin for BTC, dollar
   * for USD, etc.)
   */
  amount = (unit?: CurrencyUnit<T>): Big => {
    const unitToCalculate = this.getCurrencyUnit(unit);
    const multiplier = this._data.amountUnit.factor.div(unitToCalculate.factor);
    return this._data.amount
      .mul(multiplier)
      .round(unitToCalculate.decimals, Big.roundDown);
  };

  multiply = (factor: NumberInput): Money<T> => {
    const amount = this._data.amount.mul(factor);
    return this.merge({ amount });
  };

  /**
   * Divides the money amount with the provided divisor.
   *
   * Note that dividing a monetary amount cannot be exact in all cases.
   * E.g. 10 USD / 3 = 3.33 USD
   *
   * The division is performed with a precision of 20 decimals before
   * rounding back to the monetary amount. (See https://mikemcl.github.io/big.js/#dp)
   */
  divide = (divisor: NumberInput): Money<T> => {
    const amount = this._data.amount.div(divisor);
    return this.merge({ amount });
  };

  add = (money: Money<T>): Money<T> => {
    this.assertSameCurrency(money);
    const amountInMinUnit = money.amount(this._data.amountUnit.name);
    return this.merge({ amount: this._data.amount.plus(amountInMinUnit) });
  };

  subtract = (money: Money<T>): Money<T> => {
    this.assertSameCurrency(money);
    const amountInMinUnit = money.amount(this._data.amountUnit.name);
    return this.merge({ amount: this._data.amount.minus(amountInMinUnit) });
  };

  abs = (): Money<T> => {
    return this.merge({ amount: this._data.amount.abs() });
  };

  equals = (money: Money<T>): boolean => {
    return (
      this.currency === money.currency &&
      this._data.amount.eq(money.amount(this._data.amountUnit.name))
    );
  };

  greaterThan = (money: Money<T>): boolean => {
    this.assertSameCurrency(money);
    const amountInMinUnit = money.amount(this._data.amountUnit.name);
    return this._data.amount.gt(amountInMinUnit);
  };

  greaterThanOrEqual = (money: Money<T>): boolean => {
    this.assertSameCurrency(money);
    const amountInMinUnit = money.amount(this._data.amountUnit.name);
    return this._data.amount.gte(amountInMinUnit);
  };

  lessThan = (money: Money<T>): boolean => {
    this.assertSameCurrency(money);
    const amountInMinUnit = money.amount(this._data.amountUnit.name);
    return this._data.amount.lt(amountInMinUnit);
  };

  lessThanOrEqual = (money: Money<T>): boolean => {
    this.assertSameCurrency(money);
    const amountInMinUnit = money.amount(this._data.amountUnit.name);
    return this._data.amount.lte(amountInMinUnit);
  };

  isZero = (): boolean => {
    return this._data.amount.eq(0);
  };

  isPositive = (): boolean => {
    return this._data.amount.gt(0);
  };

  isNegative = (): boolean => {
    return this._data.amount.lt(0);
  };

  /**
   * Converts money to a regular javascript number for the requested currency unit.
   * If no unit is provided, base/default unit is used (bitcoin for BTC, dollar for USD, etc.)
   * Throws an error if it's not possible to keep full precision.
   */
  toNumber = (unit?: CurrencyUnit<T>): number => {
    // Don't use big.js toNumber because it sometimes returns -0.
    const str = this.toString(unit);
    const num = Number(str);

    if (
      str !==
      this.merge({
        amount: num,
        unit: unit ?? this.currencyData.baseUnit,
      }).toString(unit)
    ) {
      throw new Error('Converting to number was imprecise');
    }

    return num;
  };

  /**
   * Returns the money value as a stringified number without a currency.
   *
   * If you want to include the currency as well use `toLocaleString` instead.
   *
   * @param unit Specifies the currency unit to return. If not provided the base/default unit is used (bitcoin for BTC,
   * dollar for USD, etc.)
   */
  toString = (unit?: CurrencyUnit<T>): string => {
    const currencyUnit = this.getCurrencyUnit(unit);
    const amount = this.amount(currencyUnit.name);
    return amount.toFixed(currencyUnit.decimals);
  };

  /**
   * Returns the money value as a localized stringified number.
   * @param locale Locale to use to format the number. If not provided the locale of the machine will be used.
   * @param unit Specifies the currency unit to return. If not provided the base/default unit is used (bitcoin for BTC,
   * dollar for USD, etc.)
   * @param minimumFractionDigits Minimum number of fraction digits to show. Set to 'max' to show all possible decimals for the currency unit.
   * @param showCurrency Controls if the currency symbol should be included in the string. True by default
   */
  toLocaleString = ({
    locale,
    unit,
    minimumFractionDigits,
    showCurrency = true,
  }: {
    locale?: string;
    unit?: CurrencyUnit<T>;
    minimumFractionDigits?: number | 'max';
    showCurrency?: boolean;
  } = {}): string => {
    const currencyUnit = this.getCurrencyUnit(unit);
    const options: FormatOptions = { locale, minimumFractionDigits };
    if (showCurrency) {
      options.currency = this.currency;
    }
    return currencyUnit.format(this.toNumber(unit), options);
  };

  /**
   * Returns the parts of the localized stringified number.
   * @param locale Locale to use to format the number. If not provided the locale of the machine will be used.
   * @param unit Specifies the currency unit to use. If not provided the base/default unit is used (bitcoin for BTC,
   * dollar for USD, etc.)
   * @param minimumFractionDigits Minimum number of fraction digits to show. Set to 'max' to show all possible decimals for the currency unit.
   * @returns {LocalizedStringParts} The parsed parts of the formatted string
   */
  toLocalizedStringParts = ({
    locale,
    unit,
    minimumFractionDigits,
  }: {
    locale?: string;
    unit?: CurrencyUnit<T>;
    minimumFractionDigits?: number | 'max';
  } = {}): LocalizedStringParts => {
    const currencyUnit = this.getCurrencyUnit(unit);
    const options: FormatOptions = {
      locale,
      currency: this.currency,
      minimumFractionDigits,
    };
    const formattedParts = currencyUnit.formatToParts(
      this.toNumber(unit),
      options,
    );
    const fullValue = formattedParts.map(({ value }) => value).join('');
    const integer = formattedParts
      .filter(({ type }) => type === 'integer' || type === 'group')
      .map(({ value }) => value)
      .join('');
    const groupSeparator =
      formattedParts.find(({ type }) => type === 'group')?.value ?? '';
    const decimalSeparator =
      formattedParts.find(({ type }) => type === 'decimal')?.value ?? '';
    const fraction =
      formattedParts.find(({ type }) => type === 'fraction')?.value ?? '';
    const currencySymbol =
      formattedParts.find(({ type }) => type === 'currency')?.value ?? '';
    const currencySymbolPosition =
      formattedParts[0].type === 'currency' ? 'prefix' : 'suffix';

    return {
      fullValue,
      integer,
      groupSeparator,
      fraction,
      numberOfDecimals: fraction.length,
      decimalSeparator,
      currencySymbol,
      currencySymbolPosition,
    };
  };

  /**
   * Returns the money value as a JSON object.
   * This method is used by JSON.stringify to serialize the money object.
   * @returns The money value as a JSON object.
   */
  toJSON = () => {
    const unit = this.getBaseUnit();
    return {
      __type: 'Money',
      amount: this.toNumber(unit),
      currency: this.currency,
      unit,
    };
  };

  /**
   * Converts the money to the provided currency based on the provided exchange rate.
   * @param currency Currency to convert the money to (target currency)
   * @param exchangeRate Exchange rate to apply. The rate has to be in source/target currency format. E.g. if converting
   * USD to BTC, the rate should be in USD/BTC format. If converting BTC to usd it should be in USD/BTC format.
   */
  convert = <U extends Currency>(
    currency: U,
    exchangeRate: NumberInput,
  ): Money<U> => {
    const destinationCurrencyBaseUnit = getCurrencyBaseUnit(currency);
    const amount = this.amount()
      .mul(exchangeRate)
      .round(destinationCurrencyBaseUnit.decimals, Big.roundHalfUp);
    return new Money({ amount, currency });
  };

  private get currencyData(): CurrencyData<T> {
    return currencyDataMap[this.currency];
  }

  private static getCurrencyDataForInput<T extends Currency>(
    data: MoneyInput<T>,
  ): {
    baseUnit: UnitData<T>;
    minUnit: UnitData<T>;
    selectedUnit: UnitData<T> | undefined;
  } {
    const currencyData = currencyDataMap[data.currency];
    if (!currencyData) {
      throw new Error(`Unsupported currency: ${data.currency}`);
    }

    const minUnit = currencyData.units.reduce((minItem, currentItem) => {
      return currentItem.factor.lt(minItem.factor) ? currentItem : minItem;
    });
    const baseUnit = currencyData.units.find(
      (x) => x.name === currencyData.baseUnit,
    );
    if (!minUnit || !baseUnit) {
      throw new Error(`Misconfigured currency: ${data.currency}`);
    }

    const selectedUnit = data.unit
      ? currencyData.units.find((x) => x.name === data.unit)
      : undefined;
    if (data.unit && !selectedUnit) {
      throw new Error(
        `Unsupported unit: ${data.unit} for currency ${data.currency}`,
      );
    }

    return { baseUnit, minUnit, selectedUnit };
  }

  private getCurrencyUnit = (
    unitName: CurrencyUnit<T> = this.currencyData.baseUnit,
  ): UnitData<T> => {
    const currencyUnit = this.currencyData.units.find(
      (x) => x.name === unitName,
    );
    if (!currencyUnit) {
      throw new Error(
        `Unsupported unit: ${unitName} for currency ${this.currency}`,
      );
    }
    return currencyUnit;
  };

  private assertSameCurrency = (money: Money<T>): Money<T> => {
    if (money.currency !== this.currency) {
      throw new Error('Currencies must be the same');
    }
    return this;
  };

  private merge = (data: Partial<MoneyInput<T>>): Money<T> => {
    const { amountUnit, ...rest } = this._data;
    return new Money({ unit: amountUnit.name, ...rest, ...data });
  };
}
