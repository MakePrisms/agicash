import { getDefaultUnit } from '@agicash/sdk/features/shared/currencies';
import type { Money } from '@agicash/sdk/lib/money/index';
import { ArrowUpDown } from 'lucide-react';
import { MoneyDisplay } from '~/components/money-display';
import { Skeleton } from '~/components/ui/skeleton';

type ConvertedMoneySwitcherProps = {
  onSwitch: () => void;
  money?: Money;
};

export const ConvertedMoneySwitcher = ({
  onSwitch,
  money,
}: ConvertedMoneySwitcherProps) => {
  if (!money) {
    return <Skeleton className="h-6 w-24" />;
  }

  return (
    <button
      type="button"
      className="flex items-center gap-1"
      onClick={onSwitch}
    >
      <MoneyDisplay
        money={money}
        unit={getDefaultUnit(money.currency)}
        size="sm"
        variant="muted"
      />
      <ArrowUpDown className="mb-1 text-muted-foreground" />
    </button>
  );
};
