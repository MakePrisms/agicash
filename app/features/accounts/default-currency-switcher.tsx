import { createContext, useContext, useState } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '~/components/ui/drawer';
import { useToast } from '~/hooks/use-toast';
import type { Currency } from '~/lib/money/types';
import { useSetDefaultCurrency, useUser } from '../user/user-hooks';

type DefaultCurrencySwitcherContextValue = {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  defaultCurrency: Currency;
  handleCurrencySelect: (currency: Currency) => Promise<void>;
};

const DefaultCurrencySwitcherContext =
  createContext<DefaultCurrencySwitcherContextValue | null>(null);

function useDefaultCurrencySwitcherContext() {
  const context = useContext(DefaultCurrencySwitcherContext);
  if (!context) {
    throw new Error(
      'DefaultCurrencySwitcher compound components must be used within DefaultCurrencySwitcher',
    );
  }
  return context;
}

type DefaultCurrencySwitcherProps = {
  children: React.ReactNode;
};

/** A drawer that allows the user to switch their default currency */
export function DefaultCurrencySwitcher({
  children,
}: DefaultCurrencySwitcherProps) {
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
    <DefaultCurrencySwitcherContext.Provider
      value={{
        isOpen,
        setIsOpen,
        defaultCurrency,
        handleCurrencySelect,
      }}
    >
      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        {children}
      </Drawer>
    </DefaultCurrencySwitcherContext.Provider>
  );
}

type TriggerProps = {
  children: React.ReactNode;
};

DefaultCurrencySwitcher.Trigger = function Trigger({ children }: TriggerProps) {
  return <DrawerTrigger asChild>{children}</DrawerTrigger>;
};

type ContentProps = {
  children: React.ReactNode;
};

DefaultCurrencySwitcher.Content = function Content({ children }: ContentProps) {
  return (
    <DrawerContent className="pb-14 font-primary">
      <div className="mx-auto w-full max-w-sm">
        <DrawerHeader>
          <DrawerTitle>Select Currency</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-4 p-4 pb-8">{children}</div>
      </div>
    </DrawerContent>
  );
};

type CurrencyCardWrapperProps = {
  currency: Currency;
  children: React.ReactNode;
};

/**
 * Wrapper component for currency cards that handles selection
 */
DefaultCurrencySwitcher.CurrencyCardWrapper = function CurrencyCardWrapper({
  currency,
  children,
}: CurrencyCardWrapperProps) {
  const { handleCurrencySelect } = useDefaultCurrencySwitcherContext();

  return (
    <button
      type="button"
      className="w-full"
      onClick={() => handleCurrencySelect(currency)}
    >
      {children}
    </button>
  );
};
