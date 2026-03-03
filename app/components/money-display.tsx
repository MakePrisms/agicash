import { type VariantProps, cva } from 'class-variance-authority';
import type { Currency, CurrencyUnit } from '~/lib/money';
import type { Money } from '~/lib/money';
import { cn } from '~/lib/utils';

const textVariants = cva('', {
  variants: {
    variant: {
      default: '',
      muted: 'text-muted-foreground',
    },
    size: {
      xs: 'font-semibold',
      sm: 'font-semibold',
      md: 'font-bold',
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
      xs: 'text-[1.1rem]',
      sm: 'text-[1.33rem]',
      md: 'text-[2.85rem]',
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
      xs: 'pt-0.5 text-xl',
      sm: 'pt-1 text-2xl',
      md: 'pt-1.5 text-5xl',
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
