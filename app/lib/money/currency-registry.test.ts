import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Big } from 'big.js';
import { CurrencyRegistry } from './currency-registry';
import type { CompleteCurrencyData } from './types';

describe('CurrencyRegistry', () => {
  let registry: CurrencyRegistry;

  beforeEach(() => {
    registry = CurrencyRegistry.getInstance();
  });

  afterEach(() => {
    registry.reset();
  });

  describe('getInstance', () => {
    it('returns the same instance (singleton)', () => {
      const instance1 = CurrencyRegistry.getInstance();
      const instance2 = CurrencyRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getCurrencyData', () => {
    it('returns default USD data', () => {
      const usdData = registry.getCurrencyData('USD');
      expect(usdData.baseUnit).toBe('usd');
      expect(usdData.units).toHaveLength(2);
      expect(usdData.units[0].name).toBe('usd');
      expect(usdData.units[1].name).toBe('cent');
    });

    it('returns default BTC data', () => {
      const btcData = registry.getCurrencyData('BTC');
      expect(btcData.baseUnit).toBe('btc');
      expect(btcData.units).toHaveLength(3);
      expect(btcData.units[0].name).toBe('btc');
      expect(btcData.units[1].name).toBe('sat');
      expect(btcData.units[2].name).toBe('msat');
    });

    it('throws error for unsupported currency', () => {
      // biome-ignore lint/suspicious/noExplicitAny: Testing runtime error for unsupported currency
      expect(() => registry.getCurrencyData('EUR' as any)).toThrow(
        'Unsupported currency: "EUR"',
      );
    });
  });

  describe('getRegisteredCurrencies', () => {
    it('returns default currencies', () => {
      const currencies = registry.getRegisteredCurrencies();
      expect(currencies).toContain('USD');
      expect(currencies).toContain('BTC');
    });

    it('includes custom currencies after configuration', () => {
      // biome-ignore lint/suspicious/noExplicitAny: Test currency doesn't have predefined types
      const eurData: CompleteCurrencyData<any> = {
        baseUnit: 'eur',
        units: [
          {
            name: 'eur',
            decimals: 2,
            symbol: '€',
            factor: new Big(1),
            formatToParts: (value) => [
              { type: 'currency', value: '€' },
              { type: 'integer', value: value.toString() },
            ],
            format: (value) => `€${value}`,
          },
        ],
      };

      registry.configure({
        currencies: {
          EUR: eurData,
        },
      });

      const currencies = registry.getRegisteredCurrencies();
      expect(currencies).toContain('USD');
      expect(currencies).toContain('BTC');
      expect(currencies).toContain('EUR');
    });
  });

  describe('isCurrencyRegistered', () => {
    it('returns true for default currencies', () => {
      expect(registry.isCurrencyRegistered('USD')).toBe(true);
      expect(registry.isCurrencyRegistered('BTC')).toBe(true);
    });

    it('returns false for unregistered currency', () => {
      expect(registry.isCurrencyRegistered('EUR')).toBe(false);
    });

    it('returns true after registering custom currency', () => {
      // biome-ignore lint/suspicious/noExplicitAny: Test currency doesn't have predefined types
      const jpyData: CompleteCurrencyData<any> = {
        baseUnit: 'yen',
        units: [
          {
            name: 'yen',
            decimals: 0,
            symbol: '¥',
            factor: new Big(1),
            formatToParts: (value) => [
              { type: 'currency', value: '¥' },
              { type: 'integer', value: value.toString() },
            ],
            format: (value) => `¥${value}`,
          },
        ],
      };

      registry.configure({
        currencies: {
          JPY: jpyData,
        },
      });

      expect(registry.isCurrencyRegistered('JPY')).toBe(true);
    });
  });

  describe('configure', () => {
    it('allows overriding base unit of existing currency', () => {
      registry.configure({
        currencies: {
          BTC: {
            baseUnit: 'sat',
          },
        },
      });

      const btcData = registry.getCurrencyData('BTC');
      expect(btcData.baseUnit).toBe('sat');
      // Units should still be present
      expect(btcData.units).toHaveLength(3);
    });

    it('allows adding new currency with complete data', () => {
      // biome-ignore lint/suspicious/noExplicitAny: Test currency doesn't have predefined types
      const gbpData: CompleteCurrencyData<any> = {
        baseUnit: 'gbp',
        units: [
          {
            name: 'gbp',
            decimals: 2,
            symbol: '£',
            factor: new Big(1),
            formatToParts: (value) => [
              { type: 'currency', value: '£' },
              { type: 'integer', value: value.toString() },
            ],
            format: (value) => `£${value}`,
          },
          {
            name: 'pence',
            decimals: 0,
            symbol: 'p',
            factor: new Big(10 ** -2),
            formatToParts: (value) => [
              { type: 'integer', value: value.toString() },
              { type: 'currency', value: 'p' },
            ],
            format: (value) => `${value}p`,
          },
        ],
      };

      registry.configure({
        currencies: {
          GBP: gbpData,
        },
      });

      // biome-ignore lint/suspicious/noExplicitAny: Test currency doesn't have predefined types
      const data = registry.getCurrencyData('GBP' as any);
      expect(data.baseUnit).toBe('gbp');
      expect(data.units).toHaveLength(2);
    });

    it('throws error when adding incomplete new currency', () => {
      expect(() => {
        registry.configure({
          currencies: {
            EUR: {
              baseUnit: 'eur',
              // Missing units array
            },
          },
        });
      }).toThrow('Incomplete currency data for "EUR"');
    });

    it('allows overriding existing unit properties', () => {
      registry.configure({
        currencies: {
          USD: {
            units: [
              {
                name: 'cent',
                symbol: '¢¢', // Override symbol
              },
            ],
          },
        },
      });

      const usdData = registry.getCurrencyData('USD');
      const centUnit = usdData.units.find((u) => u.name === 'cent');
      expect(centUnit?.symbol).toBe('¢¢');
      // Other properties should be preserved
      expect(centUnit?.decimals).toBe(0);
    });

    it('allows adding new unit to existing currency', () => {
      registry.configure({
        currencies: {
          BTC: {
            units: [
              {
                // biome-ignore lint/suspicious/noExplicitAny: Test unit doesn't have predefined types
                name: 'ksat' as any,
                decimals: 0,
                symbol: 'ksat',
                factor: new Big(10 ** -5), // 1 ksat = 1000 sats = 0.00001 BTC
                formatToParts: (value) => [
                  { type: 'integer', value: value.toString() },
                  { type: 'currency', value: ' ksat' },
                ],
                format: (value) => `${value} ksat`,
              },
            ],
          },
        },
      });

      const btcData = registry.getCurrencyData('BTC');
      expect(btcData.units).toHaveLength(4); // btc, sat, msat, ksat
      const ksatUnit = btcData.units.find((u) => u.name === 'ksat');
      expect(ksatUnit).toBeDefined();
      expect(ksatUnit?.symbol).toBe('ksat');
    });

    it('throws error when adding incomplete new unit', () => {
      expect(() => {
        registry.configure({
          currencies: {
            BTC: {
              units: [
                {
                  // biome-ignore lint/suspicious/noExplicitAny: Test unit doesn't have predefined types
                  name: 'newunit' as any,
                  symbol: 'nu',
                  // Missing other required fields
                },
              ],
            },
          },
        });
      }).toThrow('Incomplete unit data for new unit "newunit"');
    });

    it('warns when called multiple times', () => {
      const consoleSpy = {
        // biome-ignore lint/suspicious/noExplicitAny: Spy for console.warn arguments
        calls: [] as any[],
      };
      const originalWarn = console.warn;
      // biome-ignore lint/suspicious/noExplicitAny: Spy for console.warn arguments
      console.warn = (...args: any[]) => {
        consoleSpy.calls.push(args);
      };

      registry.configure({
        currencies: {
          BTC: { baseUnit: 'sat' },
        },
      });

      registry.configure({
        currencies: {
          BTC: { baseUnit: 'btc' },
        },
      });

      expect(consoleSpy.calls).toHaveLength(1);
      expect(consoleSpy.calls[0][0]).toContain(
        'configure() called multiple times',
      );

      console.warn = originalWarn;
    });

    it('merges multiple currencies in one call', () => {
      // biome-ignore lint/suspicious/noExplicitAny: Test currency doesn't have predefined types
      const eurData: CompleteCurrencyData<any> = {
        baseUnit: 'eur',
        units: [
          {
            name: 'eur',
            decimals: 2,
            symbol: '€',
            factor: new Big(1),
            formatToParts: (value) => [
              { type: 'currency', value: '€' },
              { type: 'integer', value: value.toString() },
            ],
            format: (value) => `€${value}`,
          },
        ],
      };

      registry.configure({
        currencies: {
          BTC: { baseUnit: 'sat' },
          EUR: eurData,
        },
      });

      expect(registry.getCurrencyData('BTC').baseUnit).toBe('sat');
      // biome-ignore lint/suspicious/noExplicitAny: Test currency doesn't have predefined types
      expect(registry.getCurrencyData('EUR' as any).baseUnit).toBe('eur');
    });
  });

  describe('reset', () => {
    it('clears custom configuration', () => {
      registry.configure({
        currencies: {
          BTC: { baseUnit: 'sat' },
        },
      });

      const btcData = registry.getCurrencyData('BTC');
      expect(btcData.baseUnit).toBe('sat');

      registry.reset();

      const btcDataAfterReset = registry.getCurrencyData('BTC');
      expect(btcDataAfterReset.baseUnit).toBe('btc'); // Back to default
    });

    it('removes custom currencies', () => {
      // biome-ignore lint/suspicious/noExplicitAny: Test currency doesn't have predefined types
      const eurData: CompleteCurrencyData<any> = {
        baseUnit: 'eur',
        units: [
          {
            name: 'eur',
            decimals: 2,
            symbol: '€',
            factor: new Big(1),
            formatToParts: (value) => [
              { type: 'currency', value: '€' },
              { type: 'integer', value: value.toString() },
            ],
            format: (value) => `€${value}`,
          },
        ],
      };

      registry.configure({
        currencies: {
          EUR: eurData,
        },
      });

      expect(registry.isCurrencyRegistered('EUR')).toBe(true);

      registry.reset();

      expect(registry.isCurrencyRegistered('EUR')).toBe(false);
    });
  });

  describe('integration with default currency data', () => {
    it('preserves all default USD units when overriding', () => {
      registry.configure({
        currencies: {
          USD: {
            baseUnit: 'cent', // Change base unit
          },
        },
      });

      const usdData = registry.getCurrencyData('USD');
      expect(usdData.baseUnit).toBe('cent');
      expect(usdData.units).toHaveLength(2);
      expect(usdData.units.find((u) => u.name === 'usd')).toBeDefined();
      expect(usdData.units.find((u) => u.name === 'cent')).toBeDefined();
    });

    it('preserves all default BTC units when overriding', () => {
      registry.configure({
        currencies: {
          BTC: {
            baseUnit: 'sat',
          },
        },
      });

      const btcData = registry.getCurrencyData('BTC');
      expect(btcData.baseUnit).toBe('sat');
      expect(btcData.units).toHaveLength(3);
      expect(btcData.units.find((u) => u.name === 'btc')).toBeDefined();
      expect(btcData.units.find((u) => u.name === 'sat')).toBeDefined();
      expect(btcData.units.find((u) => u.name === 'msat')).toBeDefined();
    });
  });
});
