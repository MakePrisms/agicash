import { type VariantProps, cva } from 'class-variance-authority';
import type { Currency, CurrencyUnit } from '~/lib/money';
import { Money } from '~/lib/money';
import { cn } from '~/lib/utils';

const textVariants = cva('', {
  variants: {
    variant: {
      default: '',
      muted: 'text-muted-foreground',
    },
    size: {
      sm: 'font-semibold',
      lg: 'font-bold',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'lg',
  },
});

const symbolVariants = cva('', {
  variants: {
    size: {
      sm: 'text-[1.33rem]',
      lg: 'text-[3.45rem]',
    },
  },
  defaultVariants: {
    size: 'lg',
  },
});

const valueVariants = cva('font-numeric', {
  variants: {
    size: {
      sm: 'pt-1 text-2xl',
      lg: 'pt-2 text-6xl',
    },
  },
  defaultVariants: {
    size: 'lg',
  },
});

type Variants = VariantProps<typeof textVariants> &
  VariantProps<typeof symbolVariants> &
  VariantProps<typeof valueVariants>;

interface MoneyInputDisplayProps<C extends Currency = Currency> {
  /** Raw input value from user (e.g., "1", "1.", "1.0") */
  inputValue: string;
  currency: C;
  unit?: CurrencyUnit<C>;
  locale?: string;
}

export function MoneyInputDisplay<C extends Currency>({
  inputValue,
  currency,
  unit,
  locale,
}: MoneyInputDisplayProps<C>) {
  const money = new Money({ amount: inputValue, currency, unit });
  const {
    currencySymbol,
    currencySymbolPosition,
    integer,
    numberOfDecimals,
    decimalSeparator,
  } = money.toLocalizedStringParts({
    locale,
    unit,
    minimumFractionDigits: 'max',
  });

  // Get decimal part of the input value
  const inputHasDecimalPoint = decimalSeparator
    ? inputValue.includes(decimalSeparator)
    : false;
  const inputDecimals = inputHasDecimalPoint
    ? inputValue.split(decimalSeparator)[1]
    : '';

  // If decimal part exists in the input value, pad with zeros to numberOfDecimals places
  const needsPaddedZeros =
    inputHasDecimalPoint && inputDecimals.length < numberOfDecimals;
  const paddedZeros = needsPaddedZeros
    ? '0'.repeat(numberOfDecimals - inputDecimals.length)
    : '';

  const symbol = (
    <span className={symbolVariants({ size: 'lg' })}>{currencySymbol}</span>
  );

  return (
    <span className={textVariants({ size: 'lg' })}>
      {currencySymbolPosition === 'prefix' && symbol}
      <span className={valueVariants({ size: 'lg' })}>
        {integer}
        {(inputDecimals || needsPaddedZeros) && (
          <>
            <span>{decimalSeparator}</span>
            <span>{inputDecimals}</span>
            {paddedZeros && (
              <span className="text-gray-400">{paddedZeros}</span>
            )}
          </>
        )}
      </span>
      {currencySymbolPosition === 'suffix' && symbol}
    </span>
  );
}

type MoneyDisplayProps<C extends Currency = Currency> = {
  money: Money<C>;
  locale?: string;
  unit?: CurrencyUnit<C>;
  className?: string;
} & Variants;

export function MoneyDisplay<C extends Currency>({
  money,
  locale,
  unit,
  variant,
  size,
  className,
}: MoneyDisplayProps<C>) {
  const {
    currencySymbol,
    currencySymbolPosition,
    integer,
    decimalSeparator,
    fraction,
  } = money.toLocalizedStringParts({ locale, unit });

  const value = `${integer}${decimalSeparator}${fraction}`;

  const symbol = (
    <span className={symbolVariants({ size })}>{currencySymbol}</span>
  );

  return (
    <span className={cn(textVariants({ variant, size }), className)}>
      {currencySymbolPosition === 'prefix' && symbol}
      <span className={valueVariants({ size })}>{value}</span>
      {currencySymbolPosition === 'suffix' && symbol}
    </span>
  );
}
