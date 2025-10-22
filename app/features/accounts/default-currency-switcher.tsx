import { useState } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '~/components/ui/drawer';
import { Separator } from '~/components/ui/separator';
import { useToast } from '~/hooks/use-toast';
import type { Currency } from '~/lib/money/types';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';
import { useSetDefaultCurrency, useUser } from '../user/user-hooks';
import { useBalance } from './account-hooks';

type CurrencyOption = {
  label: string;
  currency: Currency;
};

const CURRENCY_OPTIONS: CurrencyOption[] = [
  {
    label: 'Bitcoin',
    currency: 'BTC',
  },
  {
    label: 'US Dollar',
    currency: 'USD',
  },
];

type CurrencyOptionProps = {
  data: CurrencyOption;
  isSelected: boolean;
  onSelect: (currency: Currency) => void;
};

function CurrencyOption({ data, isSelected, onSelect }: CurrencyOptionProps) {
  const { label, currency } = data;
  const balance = useBalance(currency);

  return (
    <button
      type="button"
      className="flex w-full items-center justify-between"
      onClick={() => onSelect(currency)}
    >
      <div className="flex flex-col items-start gap-1">
        <span>{label}</span>
        <MoneyWithConvertedAmount money={balance} variant="inline" />
      </div>
      <div className="aspect-square h-4 w-4 rounded-full border border-primary ring-offset-background">
        {isSelected && (
          <div className="flex h-full w-full items-center justify-center rounded-full bg-primary">
            <div className="h-2 w-2 rounded-full bg-primary-foreground" />
          </div>
        )}
      </div>
    </button>
  );
}

/** A drawer that allows the user to switch their default currency */
export function DefaultCurrencySwitcher({
  children,
}: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const defaultCurrency = useUser((user) => user.defaultCurrency);
  const setDefaultCurrency = useSetDefaultCurrency();

  const handleCurrencySelect = async (currency: Currency) => {
    try {
      await setDefaultCurrency(currency);
      setIsOpen(false);
    } catch (error) {
      console.error(error);
      toast({
        title: 'Error',
        description: 'Failed to set default currency. Please try again',
      });
    }
  };

  return (
    <Drawer open={isOpen} onOpenChange={setIsOpen}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent
        className="pb-14 font-primary"
        aria-describedby={undefined}
      >
        <div className="mx-auto w-full max-w-sm">
          <DrawerHeader>
            <DrawerTitle>Select Currency</DrawerTitle>
          </DrawerHeader>
          <div className="space-y-4 p-4 pb-8">
            {CURRENCY_OPTIONS.map((option, index) => (
              <div key={option.label}>
                <CurrencyOption
                  data={option}
                  isSelected={defaultCurrency === option.currency}
                  onSelect={handleCurrencySelect}
                />
                {index < CURRENCY_OPTIONS.length - 1 && (
                  <Separator className="mt-4" />
                )}
              </div>
            ))}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
