# Money Library

A type-safe, immutable money handling library for JavaScript/TypeScript with multi-currency support, configurable default units, and precise arithmetic operations.

## Overview

The Money library provides:
- **Type-safe currency handling** with built-in support for USD and BTC
- **Configurable default units** - set satoshis as the default unit for BTC
- **Extensible currency system** - add custom currencies with TypeScript module augmentation
- **Precise arithmetic** - uses `big.js` to avoid floating-point errors
- **Immutable operations** - all operations return new Money instances
- **Localization support** - format money amounts for different locales

## Quick Start

### Basic Usage

```typescript
import { Money } from '~/lib/money';

// Create money with default unit (USD defaults to 'usd', BTC defaults to 'btc')
const dollars = new Money({ amount: 100, currency: 'USD' });
console.log(dollars.toLocaleString()); // "$100.00"

// Create money with specific unit
const sats = new Money({ amount: 10000, currency: 'BTC', unit: 'sat' });
console.log(sats.toLocaleString()); // "₿10,000"

// Arithmetic operations
const total = dollars.add(new Money({ amount: 50, currency: 'USD' }));
console.log(total.toLocaleString()); // "$150.00"
```

### Configuring Default Units

In Agicash, we configure BTC to use satoshis as the default unit:

```typescript
// app/entry.client.tsx
import { Money } from '~/lib/money';

Money.configure({
  currencies: {
    BTC: {
      baseUnit: 'sat', // Override default from 'btc' to 'sat'
    },
  },
});

// Now BTC amounts default to satoshis
const btc = new Money({ amount: 100000, currency: 'BTC' });
console.log(btc.toString()); // "100000" (in sats)
console.log(btc.toLocaleString()); // "₿100,000"
```

## Core Concepts

### Currency Units

Each currency has multiple units with different precision levels:

**USD**:
- `usd` (base unit): 2 decimals, symbol: $
- `cent`: 0 decimals, symbol: ¢

**BTC**:
- `btc` (default base unit): 8 decimals, symbol: ₿
- `sat`: 0 decimals, symbol: ₿
- `msat`: 0 decimals, symbol: msat

### Internal Storage

Money amounts are stored internally in the **smallest unit** for maximum precision:
- USD amounts are stored as cents
- BTC amounts are stored as millisatoshis (msat)

This ensures no precision loss during calculations.

### Base Unit

The **base unit** is the default unit used when:
- No unit is specified in Money constructor
- Calling `amount()` without arguments
- Calling `toString()` without arguments
- Converting between currencies

By default, BTC's base unit is 'btc', but Agicash configures it to 'sat'.

## API Reference

### Static Methods

#### `Money.configure(config: MoneyConfiguration)`

Configure currency settings. Should be called once at app initialization.

```typescript
Money.configure({
  currencies: {
    BTC: { baseUnit: 'sat' }, // Override base unit
    EUR: { // Add new currency (requires complete configuration)
      baseUnit: 'eur',
      units: [/* ... */]
    }
  }
});
```

#### `Money.sum(moneys: Money[])`

Sum an array of money amounts:

```typescript
const amounts = [
  new Money({ amount: 100, currency: 'USD' }),
  new Money({ amount: 200, currency: 'USD' }),
];
const total = Money.sum(amounts);
console.log(total.toString()); // "300.00"
```

#### `Money.max(moneys: Money[])` / `Money.min(moneys: Money[])`

Find maximum or minimum amount:

```typescript
const max = Money.max([
  new Money({ amount: 100, currency: 'USD' }),
  new Money({ amount: 50, currency: 'USD' }),
]);
console.log(max.toString()); // "100.00"
```

#### `Money.compare(money1: Money, money2: Money)`

Compare two money amounts (returns -1, 0, or 1):

```typescript
const amounts = [
  new Money({ amount: 100, currency: 'USD' }),
  new Money({ amount: 50, currency: 'USD' }),
];
amounts.sort(Money.compare); // Ascending order
```

#### `Money.zero(currency: Currency)`

Create a zero amount:

```typescript
const zero = Money.zero('USD');
console.log(zero.toString()); // "0.00"
```

#### `Money.createMinAmount(currency, unit?)`

Create the minimum representable amount for a currency:

```typescript
const minSat = Money.createMinAmount('BTC', 'sat');
console.log(minSat.toString('sat')); // "1"
```

### Instance Methods

#### Arithmetic Operations

All operations return new Money instances (immutable):

```typescript
const a = new Money({ amount: 100, currency: 'USD' });
const b = new Money({ amount: 50, currency: 'USD' });

a.add(b);           // $150.00
a.subtract(b);      // $50.00
a.multiply(2);      // $200.00
a.divide(4);        // $25.00
a.abs();            // Absolute value
```

#### Comparison Operations

```typescript
const a = new Money({ amount: 100, currency: 'USD' });
const b = new Money({ amount: 50, currency: 'USD' });

a.equals(b);              // false
a.greaterThan(b);         // true
a.greaterThanOrEqual(b);  // true
a.lessThan(b);            // false
a.lessThanOrEqual(b);     // false
a.isZero();               // false
a.isPositive();           // true
a.isNegative();           // false
```

#### Formatting Methods

```typescript
const money = new Money({ amount: 1234.56, currency: 'USD' });

// Get raw amount as Big number
money.amount();              // Big(1234.56)
money.amount('cent');        // Big(123456)

// Convert to string (number only, no currency)
money.toString();            // "1234.56"
money.toString('cent');      // "123456"

// Convert to localized string (with currency)
money.toLocaleString();      // "$1,234.56"
money.toLocaleString({
  locale: 'de-DE',
  unit: 'cent',
  minimumFractionDigits: 2
});                          // "123.456,00¢"

// Get formatted parts (for custom rendering)
const parts = money.toLocalizedStringParts();
console.log(parts.integer);        // "1,234"
console.log(parts.fraction);       // "56"
console.log(parts.currencySymbol); // "$"

// Convert to number (throws if precision would be lost)
money.toNumber();            // 1234.56
```

#### Currency Conversion

```typescript
const usd = new Money({ amount: 50000, currency: 'USD' });
const rate = new Big(1).div(50000); // 1 BTC = $50,000
const btc = usd.convert('BTC', rate);
console.log(btc.toString()); // "1.00000000"
```

#### Utility Methods

```typescript
const money = new Money({ amount: 100, currency: 'BTC', unit: 'sat' });

money.currency;                    // "BTC"
money.getMaxDecimals('sat');       // 0
money.getCurrencySymbol('sat');    // "₿"
```

## Adding Custom Currencies

### Option 1: TypeScript Module Augmentation (Recommended)

For type-safe custom currencies, use module augmentation:

```typescript
// types/money.d.ts
import { Big } from 'big.js';

declare global {
  interface CustomCurrencies {
    EUR: { units: 'eur' | 'cent' };
  }
}

// Then configure at runtime
import { Money } from '~/lib/money';

Money.configure({
  currencies: {
    EUR: {
      baseUnit: 'eur',
      units: [
        {
          name: 'eur',
          decimals: 2,
          symbol: '€',
          factor: new Big(1),
          formatToParts: function(value, options = {}) {
            // Formatting logic
          },
          format: function(value, options = {}) {
            return this.formatToParts(value, options)
              .map(({ value }) => value)
              .join('');
          },
        },
        {
          name: 'cent',
          decimals: 0,
          symbol: 'c',
          factor: new Big(10 ** -2),
          // ... formatting functions
        },
      ],
    },
  },
});

// Now you have full type safety:
const euros = new Money({ amount: 100, currency: 'EUR' });
const inCents = euros.amount('cent'); // Type-safe unit!
```

### Option 2: Runtime Registration Only

For dynamic currencies without TypeScript types:

```typescript
Money.configure({
  currencies: {
    JPY: {
      baseUnit: 'yen',
      units: [{
        name: 'yen',
        decimals: 0,
        symbol: '¥',
        factor: new Big(1),
        formatToParts: /* ... */,
        format: /* ... */,
      }],
    },
  },
});

// Works at runtime but with looser types:
const yen = new Money({ amount: 1000, currency: 'JPY' as any });
```

### Overriding Existing Currency Settings

You can partially override existing currencies:

```typescript
Money.configure({
  currencies: {
    BTC: {
      baseUnit: 'sat', // Only override base unit
      // units are inherited from defaults
    },
    USD: {
      units: [
        {
          name: 'cent',
          symbol: '¢¢', // Override just the symbol
          // Other properties inherited
        }
      ]
    }
  },
});
```

## Architecture

### Files

- **`money.ts`** - Main `Money` class with immutable operations
- **`currency-registry.ts`** - Singleton managing currency configuration
- **`currency-data.ts`** - Default currency definitions (USD, BTC)
- **`types.ts`** - TypeScript types and interfaces

### CurrencyRegistry

The `CurrencyRegistry` is a singleton that:
1. Stores default currency data (USD, BTC)
2. Merges custom configuration at runtime
3. Validates new currencies have complete data
4. Allows partial overrides of existing currencies

```typescript
// Internal API (accessed via Money class)
const registry = CurrencyRegistry.getInstance();

registry.configure({ /* ... */ });
registry.getCurrencyData('BTC');
registry.getRegisteredCurrencies(); // ['USD', 'BTC', ...]
registry.isCurrencyRegistered('EUR'); // false
registry.reset(); // Useful for testing
```

### Type System

The library uses a sophisticated type system to provide:
- Autocomplete for currency codes ('USD', 'BTC', custom currencies)
- Type-safe unit names per currency (`BtcUnit = 'btc' | 'sat' | 'msat'`)
- Support for both predefined and runtime-registered currencies

## Best Practices

### ✅ Do

```typescript
// Use Money class for all currency operations
const total = Money.sum([
  new Money({ amount: 100, currency: 'USD' }),
  new Money({ amount: 50, currency: 'USD' }),
]);

// Configure once at app initialization
Money.configure({ currencies: { BTC: { baseUnit: 'sat' } } });

// Use Big.js for exchange rates
import { Big } from 'big.js';
const rate = new Big(0.000020); // USD/BTC rate
```

### ❌ Don't

```typescript
// Never use raw arithmetic on money amounts
const total = 100.10 + 200.20; // ❌ Floating point errors!

// Don't configure multiple times (warns but works)
Money.configure({ /* ... */ });
Money.configure({ /* ... */ }); // ⚠️ Warns about multiple configs

// Don't mix currencies without conversion
const btc = new Money({ amount: 1, currency: 'BTC' });
const usd = new Money({ amount: 100, currency: 'USD' });
btc.add(usd); // ❌ Throws error
```

## Examples

### Example 1: Transaction History Display

```typescript
import { Money } from '~/lib/money';

function TransactionItem({ amount }: { amount: Money }) {
  return (
    <div>
      <span>{amount.toLocaleString()}</span>
      <span className="text-gray-500">
        (${amount.convert('USD', exchangeRate).toLocaleString()})
      </span>
    </div>
  );
}
```

### Example 2: Input Component with Money

```typescript
function MoneyInput({ value, onChange }: {
  value: Money,
  onChange: (money: Money) => void
}) {
  const handleChange = (input: string) => {
    const amount = parseFloat(input) || 0;
    onChange(new Money({
      amount,
      currency: value.currency
    }));
  };

  return (
    <div>
      <input
        type="number"
        value={value.toString()}
        onChange={(e) => handleChange(e.target.value)}
        step={1 / Math.pow(10, value.getMaxDecimals())}
      />
      <span>{value.getCurrencySymbol()}</span>
    </div>
  );
}
```

### Example 3: Fee Calculation

```typescript
function calculateFeeWithMinimum(
  amount: Money<'BTC'>,
  feeRate: number
): Money<'BTC'> {
  const calculatedFee = amount.multiply(feeRate);
  const minimumFee = Money.createMinAmount('BTC', 'sat');

  return calculatedFee.greaterThan(minimumFee)
    ? calculatedFee
    : minimumFee;
}
```

## Testing

The Money library includes comprehensive tests. Run them with:

```bash
bun test app/lib/money/money.test.ts
```

When testing code that uses Money:

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { Money } from '~/lib/money';
import { CurrencyRegistry } from '~/lib/money/currency-registry';

describe('MyFeature', () => {
  beforeEach(() => {
    // Configure Money for tests
    Money.configure({
      currencies: { BTC: { baseUnit: 'sat' } }
    });
  });

  afterEach(() => {
    // Reset to avoid test pollution
    CurrencyRegistry.getInstance().reset();
  });

  it('handles payments', () => {
    const amount = new Money({ amount: 1000, currency: 'BTC' });
    expect(amount.toString()).toBe('1000');
  });
});
```

## Migration Guide

If you're upgrading from the previous version:

### Before (with `getDefaultUnit`)

```typescript
import { Money, getDefaultUnit } from '~/lib/money';

const unit = getDefaultUnit('BTC'); // 'sat'
const money = new Money({ amount: 100, currency: 'BTC', unit });
console.log(money.toString(unit));
```

### After (with configured base unit)

```typescript
import { Money } from '~/lib/money';

// Configure once at app startup
Money.configure({
  currencies: { BTC: { baseUnit: 'sat' } }
});

// Now 'sat' is the default
const money = new Money({ amount: 100, currency: 'BTC' });
console.log(money.toString()); // Uses 'sat' by default
```

## Troubleshooting

### Error: "Unsupported currency"

Make sure the currency is registered:

```typescript
Money.getRegisteredCurrencies(); // ['USD', 'BTC']
Money.isCurrencyRegistered('EUR'); // false

// Register it:
Money.configure({
  currencies: {
    EUR: { /* complete config */ }
  }
});
```

### Error: "Currencies must be the same"

You tried to add/subtract different currencies:

```typescript
const btc = new Money({ amount: 1, currency: 'BTC' });
const usd = new Money({ amount: 100, currency: 'USD' });
btc.add(usd); // ❌ Error

// Convert first:
const btcEquivalent = usd.convert('BTC', exchangeRate);
btc.add(btcEquivalent); // ✅ OK
```

### Warning: "configure() called multiple times"

`Money.configure()` should only be called once at app initialization. Multiple calls override each other.

## Further Reading

- [big.js Documentation](https://mikemcl.github.io/big.js/) - The library used for precise arithmetic
- [Intl.NumberFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat) - Used for localization
- [TypeScript Module Augmentation](https://www.typescriptlang.org/docs/handbook/declaration-merging.html#module-augmentation) - For adding custom currencies
