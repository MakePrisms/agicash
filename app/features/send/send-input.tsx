import {
  ArrowUpDown,
  AtSign,
  Clipboard,
  LoaderCircle,
  Scan,
  X,
  ZapIcon,
} from 'lucide-react';
import { useState } from 'react';
import { MoneyDisplay, MoneyInputDisplay } from '~/components/money-display';
import { Numpad } from '~/components/numpad';
import {
  ClosePageButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { SearchBar } from '~/components/search-bar';
import { Button } from '~/components/ui/button';
import {
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '~/components/ui/drawer';
import { DrawerTrigger } from '~/components/ui/drawer';
import { Drawer } from '~/components/ui/drawer';
import { Skeleton } from '~/components/ui/skeleton';
import { useAccounts } from '~/features/accounts/account-hooks';
import {
  AccountSelector,
  toAccountSelectorOption,
} from '~/features/accounts/account-selector';
import useAnimation from '~/hooks/use-animation';
import { useMoneyInput } from '~/hooks/use-money-input';
import { useToast } from '~/hooks/use-toast';
import { buildLightningAddressFormatValidator } from '~/lib/lnurl';
import type { Money } from '~/lib/money';
import { readClipboard } from '~/lib/read-clipboard';
import {
  LinkWithViewTransition,
  useNavigateWithViewTransition,
} from '~/lib/transitions';
import { AddContactDrawer, ContactsList } from '../contacts';
import type { Contact } from '../contacts/contact';
import { useContacts } from '../contacts/contact-hooks';
import { getDefaultUnit } from '../shared/currencies';
import {
  DomainError,
  accountOfflineToast,
  getErrorMessage,
} from '../shared/error';
import { useSendStore } from './send-provider';

type ConvertedMoneySwitcherProps = {
  onSwitchInputCurrency: () => void;
  money?: Money;
};

const ConvertedMoneySwitcher = ({
  onSwitchInputCurrency,
  money,
}: ConvertedMoneySwitcherProps) => {
  if (!money) {
    return <Skeleton className="h-6 w-24" />;
  }

  return (
    <button
      type="button"
      className="flex items-center gap-1"
      onClick={() => {
        onSwitchInputCurrency();
      }}
    >
      <MoneyDisplay
        money={money}
        unit={getDefaultUnit(money.currency)}
        variant="secondary"
      />
      <ArrowUpDown className="mb-1" />
    </button>
  );
};

export function SendInput() {
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();
  const { animationClass: shakeAnimationClass, start: startShakeAnimation } =
    useAnimation({ name: 'shake' });
  const { data: accounts } = useAccounts();

  const sendAmount = useSendStore((s) => s.amount);
  const sendAccount = useSendStore((s) => s.getSourceAccount());
  const selectSourceAccount = useSendStore((s) => s.selectSourceAccount);
  const destinationDisplay = useSendStore((s) => s.destinationDisplay);
  const selectDestination = useSendStore((s) => s.selectDestination);
  const clearDestination = useSendStore((s) => s.clearDestination);
  const getQuote = useSendStore((s) => s.getQuote);
  const status = useSendStore((s) => s.status);

  const sendAmountCurrencyUnit = sendAmount
    ? getDefaultUnit(sendAmount.currency)
    : undefined;
  const initialInputCurrency = sendAmount?.currency ?? sendAccount.currency;

  const {
    rawInputValue,
    maxInputDecimals,
    inputValue,
    convertedValue,
    exchangeRateError,
    handleNumberInput,
    switchInputCurrency,
    setInputValue,
  } = useMoneyInput({
    initialRawInputValue: sendAmount?.toString(sendAmountCurrencyUnit) || '0',
    initialInputCurrency: initialInputCurrency,
    initialOtherCurrency: initialInputCurrency === 'BTC' ? 'USD' : 'BTC',
  });

  const handleContinue = async (
    inputValue: Money,
    convertedValue: Money | undefined,
  ) => {
    if (!sendAccount.isOnline) {
      toast(accountOfflineToast);
      return;
    }
    if (sendAccount.type !== 'cashu') {
      toast({
        title: 'Not implemented',
        description: 'Only sends from the cashu accounts are supported',
        variant: 'destructive',
      });
      return;
    }

    if (inputValue.isZero()) {
      return;
    }

    const result = await getQuote(inputValue, convertedValue);
    if (!result.success) {
      const toastOptions =
        result.error instanceof DomainError
          ? { description: result.error.message }
          : {
              title: 'Error',
              description: getErrorMessage(
                result.error,
                'Failed to get a send quote. Please try again',
              ),
              variant: 'destructive' as const,
            };

      toast(toastOptions);
      return;
    }

    navigate('/send/confirm', {
      applyTo: 'newView',
      transition: 'slideLeft',
    });
  };

  const handleSelectDestination = async (destination: string | Contact) => {
    const result = await selectDestination(destination);
    if (!result.success) {
      toast({
        title: 'Invalid destination',
        description: result.error,
        variant: 'destructive',
      });
      return false;
    }

    const {
      data: { amount },
    } = result;

    let latestInputValue = inputValue;
    let latestConvertedValue = convertedValue;

    if (amount) {
      const defaultUnit = getDefaultUnit(amount.currency);
      ({
        newInputValue: latestInputValue,
        newConvertedValue: latestConvertedValue,
      } = setInputValue(amount.toString(defaultUnit), amount.currency));
    }

    await handleContinue(latestInputValue, latestConvertedValue);
    return true;
  };

  const handlePaste = async () => {
    const input = await readClipboard();
    if (!input) {
      return;
    }

    await handleSelectDestination(input);
  };

  return (
    <>
      <PageHeader>
        <ClosePageButton to="/" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Send</PageHeaderTitle>
      </PageHeader>

      <PageContent className="mx-auto flex flex-col items-center justify-between">
        <div className="flex flex-col items-center justify-between gap-4">
          <div className="flex h-[124px] flex-col items-center gap-2">
            <div className={shakeAnimationClass}>
              <MoneyInputDisplay
                inputValue={rawInputValue}
                currency={inputValue.currency}
                unit={getDefaultUnit(inputValue.currency)}
              />
            </div>

            {!exchangeRateError && (
              <ConvertedMoneySwitcher
                onSwitchInputCurrency={switchInputCurrency}
                money={convertedValue}
              />
            )}
          </div>

          <div className="flex h-[24px] items-center justify-center gap-4">
            {destinationDisplay && (
              <>
                <p>{destinationDisplay}</p>
                <X
                  onClick={clearDestination}
                  className="h-4 w-4 cursor-pointer"
                />
              </>
            )}
          </div>
        </div>

        <div className="w-full max-w-sm sm:max-w-none">
          <AccountSelector
            accounts={accounts.map((account) =>
              toAccountSelectorOption(account),
            )}
            selectedAccount={toAccountSelectorOption(sendAccount)}
            onSelect={(account) => {
              selectSourceAccount(account);
              if (account.currency !== inputValue.currency) {
                switchInputCurrency();
              }
            }}
          />
        </div>

        <div className="flex w-full flex-col items-center gap-4 sm:items-start sm:justify-between">
          <div className="grid w-full max-w-sm grid-cols-3 gap-4 sm:max-w-none">
            <div className="flex items-center justify-start gap-4">
              <button type="button" onClick={handlePaste}>
                <Clipboard />
              </button>

              <LinkWithViewTransition
                to="/send/scan"
                transition="slideUp"
                applyTo="newView"
              >
                <Scan />
              </LinkWithViewTransition>

              <SelectContactOrLud16Drawer onSelect={handleSelectDestination} />
            </div>
            <div /> {/* spacer */}
            <div className="flex items-center justify-end">
              <Button
                onClick={() => handleContinue(inputValue, convertedValue)}
                disabled={inputValue.isZero()}
                loading={status === 'quoting'}
              >
                Continue
              </Button>
            </div>
          </div>
        </div>
      </PageContent>
      <PageFooter className="sm:pb-14">
        <Numpad
          showDecimal={maxInputDecimals > 0}
          onButtonClick={(value) => {
            handleNumberInput(value, startShakeAnimation);
          }}
        />
      </PageFooter>
    </>
  );
}

type SelectContactOrLud16DrawerProps = {
  onSelect: (contactOrLnAddress: Contact | string) => Promise<boolean>;
};

const validateLightningAddressFormat = buildLightningAddressFormatValidator({
  message: 'Invalid lightning address',
  allowLocalhost: import.meta.env.MODE === 'development',
});

function SelectContactOrLud16Drawer({
  onSelect,
}: SelectContactOrLud16DrawerProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'selecting'>('idle');

  const contacts = useContacts((contacts) =>
    contacts.filter((contact) =>
      contact.username.toLowerCase().includes(input.toLowerCase()),
    ),
  );

  const handleSelect = async (selection: string | Contact) => {
    setStatus('selecting');

    const selected = await onSelect(selection);
    if (selected) {
      setOpen(false);
      setInput('');
    }

    setStatus('idle');
  };

  const isLnAddressFormat = validateLightningAddressFormat(input) === true;

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button type="button" onClick={() => setOpen(true)}>
          <AtSign />
        </button>
      </DrawerTrigger>
      <DrawerContent className="h-[90dvh] pb-14 font-primary sm:h-[75vh]">
        <DrawerHeader className="flex items-center justify-between">
          <DrawerTitle>Send to User</DrawerTitle>
          <AddContactDrawer />
        </DrawerHeader>
        <div className="mx-auto flex h-full w-full max-w-sm flex-col gap-3 px-4 sm:px-0">
          <SearchBar
            placeholder="Username or Lightning Address"
            onSearch={(value) => setInput(value.toLowerCase())}
          />

          {isLnAddressFormat && (
            <button
              className="flex w-full items-center gap-3 p-3 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              onClick={() => handleSelect(input)}
              type="button"
              disabled={status === 'selecting'}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-sm">
                {status === 'idle' ? (
                  <ZapIcon />
                ) : (
                  <LoaderCircle className="animate-spin text-muted-foreground" />
                )}
              </div>
              <p>Send to Lightning Address: {input}</p>
            </button>
          )}
          <ContactsList contacts={contacts} onSelect={handleSelect} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
