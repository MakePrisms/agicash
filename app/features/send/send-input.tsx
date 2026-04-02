import type { Contact } from '@agicash/sdk/features/contacts/contact';
import { getDefaultUnit } from '@agicash/sdk/features/shared/currencies';
import {
  DomainError,
  getErrorMessage,
} from '@agicash/sdk/features/shared/error';
import { buildLightningAddressFormatValidator } from '@agicash/sdk/lib/lnurl/index';
import type { Money } from '@agicash/sdk/lib/money/index';
import {
  AtSign,
  Clipboard,
  LoaderCircle,
  Scan,
  X,
  ZapIcon,
} from 'lucide-react';
import { useState } from 'react';
import { MoneyInputDisplay } from '~/components/money-display';
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
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '~/components/ui/drawer';
import { useAccounts } from '~/features/accounts/account-hooks';
import {
  AccountSelector,
  toAccountSelectorOption,
} from '~/features/accounts/account-selector';
import { accountOfflineToast } from '~/features/accounts/utils';
import { ConvertedMoneySwitcher } from '~/features/shared/converted-money-switcher';
import useAnimation from '~/hooks/use-animation';
import { useMoneyInput } from '~/hooks/use-money-input';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useToast } from '~/hooks/use-toast';
import { readClipboard } from '~/lib/read-clipboard';
import {
  LinkWithViewTransition,
  useNavigateWithViewTransition,
} from '~/lib/transitions';
import { AddContactDrawer, ContactsList } from '../contacts';
import { useSendStore } from './send-provider';

export function SendInput() {
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();
  const { redirectTo } = useRedirectTo('/');
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const { animationClass: shakeAnimationClass, start: startShakeAnimation } =
    useAnimation({ name: 'shake' });
  const { data: accounts } = useAccounts();
  const [selectDestinationDrawerOpen, setSelectDestinationDrawerOpen] =
    useState(false);
  const [isContinuing, setIsContinuing] = useState(false);

  const sendAmount = useSendStore((s) => s.amount);
  const sendAccount = useSendStore((s) => s.getSourceAccount());
  const selectSourceAccount = useSendStore((s) => s.selectSourceAccount);
  const destinationDisplay = useSendStore((s) => s.destinationDisplay);
  const selectDestination = useSendStore((s) => s.selectDestination);
  const clearDestination = useSendStore((s) => s.clearDestination);
  const continueSend = useSendStore((s) => s.proceedWithSend);
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

    if (inputValue.isZero()) {
      return;
    }

    setIsContinuing(true);
    const result = await continueSend(inputValue, convertedValue);
    if (!result.success) {
      setIsContinuing(false);
      const toastOptions =
        result.error instanceof DomainError
          ? { description: result.error.message, duration: 8000 }
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

    if (result.next === 'selectDestination') {
      setSelectDestinationDrawerOpen(true);
      setIsContinuing(false);
      return;
    }

    navigate(buildLinkWithSearchParams('/send/confirm'), {
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
        <ClosePageButton
          to={redirectTo}
          transition="slideDown"
          applyTo="oldView"
        />
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
                onSwitch={switchInputCurrency}
                money={convertedValue}
              />
            )}
          </div>

          <div className="flex h-[24px] items-center justify-center gap-4">
            {destinationDisplay && (
              <>
                <p>{destinationDisplay}</p>
                <X onClick={clearDestination} className="h-4 w-4" />
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
            disabled={accounts.length === 1}
          />
        </div>

        <div className="flex w-full flex-col items-center gap-4 sm:items-start sm:justify-between">
          <div className="grid w-full max-w-sm grid-cols-3 gap-4 sm:max-w-none">
            <div className="flex items-center justify-start gap-4">
              <button type="button" onClick={handlePaste}>
                <Clipboard />
              </button>

              <LinkWithViewTransition
                to={buildLinkWithSearchParams('/send/scan')}
                transition="slideUp"
                applyTo="newView"
              >
                <Scan />
              </LinkWithViewTransition>

              {sendAccount.purpose !== 'gift-card' && (
                <SelectDestinationDrawer
                  open={selectDestinationDrawerOpen}
                  onOpenChange={setSelectDestinationDrawerOpen}
                  onSelect={handleSelectDestination}
                />
              )}
            </div>
            <div /> {/* spacer */}
            <div className="flex items-center justify-end">
              <Button
                onClick={() => handleContinue(inputValue, convertedValue)}
                disabled={inputValue.isZero()}
                loading={status === 'quoting' || isContinuing}
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

type SelectDestinationDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (contactOrLnAddress: Contact | string) => Promise<boolean>;
};

const validateLightningAddressFormat = buildLightningAddressFormatValidator({
  message: 'Invalid lightning address',
  allowLocalhost: import.meta.env.MODE === 'development',
});

function SelectDestinationDrawer({
  open,
  onOpenChange,
  onSelect,
}: SelectDestinationDrawerProps) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'selecting'>('idle');

  const handleSelect = async (selection: string | Contact) => {
    setStatus('selecting');

    const selected = await onSelect(selection);
    if (selected) {
      onOpenChange(false);
      setInput('');
    }

    setStatus('idle');
  };

  const isLnAddressFormat = validateLightningAddressFormat(input) === true;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>
        <button type="button" onClick={() => onOpenChange(true)}>
          <AtSign />
        </button>
      </DrawerTrigger>
      <DrawerContent className="h-[90svh] font-primary sm:h-[75vh]">
        <DrawerHeader className="flex shrink-0 items-center justify-between">
          <DrawerTitle>Send to User</DrawerTitle>
          <AddContactDrawer />
        </DrawerHeader>
        <div className="mx-auto flex min-h-0 w-full max-w-sm flex-1 flex-col gap-3 px-4 sm:px-0">
          <div className="shrink-0">
            <SearchBar
              placeholder="Username or Lightning Address"
              onSearch={(value) => setInput(value.toLowerCase())}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
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
            <ContactsList onSelect={handleSelect} searchQuery={input} />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
