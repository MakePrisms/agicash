import { defaultCurrencyDataMap } from './currency-data';
import type {
  CompleteCurrencyData,
  CompleteUnitData,
  Currency,
  CurrencyData,
  CurrencyDataMap,
  MoneyConfiguration,
  PartialCurrencyData,
  PartialUnitData,
  UnitData,
} from './types';

/**
 * Registry for currency configuration.
 * Manages currency data and allows runtime configuration.
 */
export class CurrencyRegistry {
  private static instance: CurrencyRegistry | null = null;
  private customCurrencyDataMap: CurrencyDataMap = {};
  private isConfigured = false;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): CurrencyRegistry {
    if (!CurrencyRegistry.instance) {
      CurrencyRegistry.instance = new CurrencyRegistry();
    }
    return CurrencyRegistry.instance;
  }

  /**
   * Configure currency data. Should be called once at app initialization.
   */
  configure(config: MoneyConfiguration): void {
    if (this.isConfigured) {
      console.warn(
        'CurrencyRegistry.configure() called multiple times. Later calls override earlier ones.',
      );
    }

    this.customCurrencyDataMap = this.buildCurrencyDataMap(config);
    this.isConfigured = true;
  }

  /**
   * Reset configuration (useful for testing)
   */
  reset(): void {
    this.customCurrencyDataMap = {};
    this.isConfigured = false;
  }

  /**
   * Get currency data for a specific currency
   */
  getCurrencyData<T extends Currency>(currency: T): CurrencyData<T> {
    const effectiveMap = this.getEffectiveCurrencyDataMap();
    const data = effectiveMap[currency];

    if (!data) {
      throw new Error(
        `Unsupported currency: "${currency}". Register it using Money.configure().`,
      );
    }

    return data;
  }

  /**
   * Get list of all registered currencies
   */
  getRegisteredCurrencies(): string[] {
    return Object.keys(this.getEffectiveCurrencyDataMap());
  }

  /**
   * Check if a currency is registered
   */
  isCurrencyRegistered(currency: string): boolean {
    return currency in this.getEffectiveCurrencyDataMap();
  }

  /**
   * Get effective currency data map (custom overrides + defaults)
   */
  private getEffectiveCurrencyDataMap(): CurrencyDataMap {
    return {
      ...defaultCurrencyDataMap,
      ...this.customCurrencyDataMap,
    };
  }

  /**
   * Build currency data map from configuration
   */
  private buildCurrencyDataMap(config: MoneyConfiguration): CurrencyDataMap {
    const customMap: CurrencyDataMap = {};

    if (!config.currencies) {
      return customMap;
    }

    for (const [currency, partialData] of Object.entries(config.currencies)) {
      const defaultData = defaultCurrencyDataMap[currency];

      if (defaultData && partialData) {
        // Merge with default data
        customMap[currency] = this.mergeCurrencyData(defaultData, partialData);
      } else if (partialData) {
        // New currency - validate it's complete
        if (!this.isCompleteCurrencyData(partialData)) {
          throw new Error(
            `Incomplete currency data for "${currency}". New currencies require complete baseUnit and units configuration.`,
          );
        }
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic currency support requires any
        customMap[currency] = partialData as CurrencyData<any>;
      }
    }

    return customMap;
  }

  /**
   * Deep merge currency data
   */
  private mergeCurrencyData<T extends Currency>(
    defaultData: CurrencyData<T>,
    partialData: PartialCurrencyData<T>,
  ): CurrencyData<T> {
    const mergedUnits = this.mergeUnits(
      defaultData.units,
      partialData.units || [],
    );

    return {
      baseUnit: partialData.baseUnit ?? defaultData.baseUnit,
      units: mergedUnits,
    };
  }

  /**
   * Merge unit arrays
   */
  private mergeUnits<T extends Currency>(
    defaultUnits: Array<UnitData<T>>,
    configUnits: Array<PartialUnitData<T>>,
  ): Array<UnitData<T>> {
    const merged = [...defaultUnits];

    for (const configUnit of configUnits) {
      const index = merged.findIndex((u) => u.name === configUnit.name);

      if (index !== -1) {
        // Merge with existing unit
        merged[index] = {
          ...merged[index],
          ...configUnit,
          formatToParts:
            configUnit.formatToParts ?? merged[index].formatToParts,
          format: configUnit.format ?? merged[index].format,
        } as UnitData<T>;
      } else {
        // New unit - must be complete
        if (!this.isCompleteUnitData(configUnit)) {
          throw new Error(
            `Incomplete unit data for new unit "${configUnit.name}". All properties required for new units.`,
          );
        }
        merged.push(configUnit as UnitData<T>);
      }
    }

    return merged;
  }

  private isCompleteCurrencyData(
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic currency support requires any
    data: PartialCurrencyData<any>,
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic currency support requires any
  ): data is CompleteCurrencyData<any> {
    return (
      data.baseUnit !== undefined &&
      data.units !== undefined &&
      data.units.length > 0 &&
      data.units.every((unit) => this.isCompleteUnitData(unit))
    );
  }

  private isCompleteUnitData(
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic currency support requires any
    unit: PartialUnitData<any>,
    // biome-ignore lint/suspicious/noExplicitAny: Dynamic currency support requires any
  ): unit is CompleteUnitData<any> {
    return (
      unit.decimals !== undefined &&
      unit.symbol !== undefined &&
      unit.factor !== undefined &&
      unit.formatToParts !== undefined &&
      unit.format !== undefined
    );
  }
}
