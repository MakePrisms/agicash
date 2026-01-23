import { Big } from 'big.js';
import type {
  BaseFormatOptions,
  CurrencyDataMap,
  FormatOptions,
} from './types';

export function getCurrencyFormatter(options: BaseFormatOptions) {
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

export const trimWhitespaceFromEnds = (
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

export const defaultCurrencyDataMap: CurrencyDataMap = {
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
