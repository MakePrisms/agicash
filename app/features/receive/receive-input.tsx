import { getEncodedToken } from '@cashu/cashu-ts';
import { ArrowUpDown, Clipboard, Scan } from 'lucide-react';
import { MoneyDisplay, MoneyInputDisplay } from '~/components/money-display';
import { Numpad } from '~/components/numpad';
import {
  ClosePageButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import {
  AccountSelector,
  toAccountSelectorOption,
} from '~/features/accounts/account-selector';
import { accountOfflineToast } from '~/features/accounts/utils';
import { getDefaultUnit } from '~/features/shared/currencies';
import useAnimation from '~/hooks/use-animation';
import { useMoneyInput } from '~/hooks/use-money-input';
import { useToast } from '~/hooks/use-toast';
import { extractCashuToken } from '~/lib/cashu';
import type { Money } from '~/lib/money';
import { readClipboard } from '~/lib/read-clipboard';
import {
  LinkWithViewTransition,
  useNavigateWithViewTransition,
} from '~/lib/transitions';
import { useAccount, useAccounts } from '../accounts/account-hooks';
import { useReceiveStore } from './receive-provider';

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
      onClick={onSwitchInputCurrency}
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

export default function ReceiveInput() {
  const navigate = useNavigateWithViewTransition();
  const { toast } = useToast();
  const { animationClass: shakeAnimationClass, start: startShakeAnimation } =
    useAnimation({ name: 'shake' });

  const receiveAccountId = useReceiveStore((s) => s.accountId);
  const receiveAccount = useAccount(receiveAccountId);
  const receiveAmount = useReceiveStore((s) => s.amount);
  const receiveCurrencyUnit = getDefaultUnit(receiveAccount.currency);
  const setReceiveAccount = useReceiveStore((s) => s.setAccount);
  const setReceiveAmount = useReceiveStore((s) => s.setAmount);
  const { data: accounts } = useAccounts();

  const {
    rawInputValue,
    maxInputDecimals,
    inputValue,
    convertedValue,
    exchangeRateError,
    handleNumberInput,
    switchInputCurrency,
  } = useMoneyInput({
    initialRawInputValue: receiveAmount?.toString(receiveCurrencyUnit) || '0',
    initialInputCurrency: receiveAccount.currency,
    initialOtherCurrency: receiveAccount.currency === 'BTC' ? 'USD' : 'BTC',
  });

  const handleContinue = async () => {
    if (!receiveAccount.isOnline) {
      toast(accountOfflineToast);
      return;
    }

    if (inputValue.currency === receiveAccount.currency) {
      setReceiveAmount(inputValue);
    } else {
      if (!convertedValue) {
        // Can't happen because when there is no converted value, the toggle will not be shown so input currency and receive currency must be the same
        return;
      }
      setReceiveAmount(convertedValue);
    }

    if (receiveAccount.type === 'cashu') {
      navigate('/receive/cashu', {
        transition: 'slideLeft',
        applyTo: 'newView',
      });
    }
    if (receiveAccount.type === 'spark') {
      navigate('/receive/spark/pending', {
        transition: 'slideLeft',
        applyTo: 'newView',
      });
    }
  };

  const handlePaste = async () => {
    const clipboardContent = await readClipboard();
    if (!clipboardContent) {
      return;
    }

    const token = extractCashuToken(clipboardContent);
    if (!token) {
      toast({
        title: 'Invalid input',
        description: 'Please paste a valid cashu token',
        variant: 'destructive',
      });
      return;
    }

    const encodedToken = getEncodedToken(token);
    const hash = `#${encodedToken}`;

    // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
    // See https://github.com/remix-run/remix/discussions/10721
    window.history.replaceState(null, '', hash);
    navigate(
      `/receive/cashu/token?selectedAccountId=${receiveAccountId}${hash}`,
      {
        transition: 'slideLeft',
        applyTo: 'newView',
      },
    );
  };

  return (
    <>
      <PageHeader>
        <ClosePageButton to="/" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Receive</PageHeaderTitle>
      </PageHeader>

      <PageContent className="mx-auto flex flex-col items-center justify-between">
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

        <div className="w-full max-w-sm sm:max-w-none">
          <AccountSelector
            accounts={accounts.map((account) =>
              toAccountSelectorOption(account),
            )}
            selectedAccount={toAccountSelectorOption(receiveAccount)}
            onSelect={(account) => {
              setReceiveAccount(account);
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
                to="/receive/scan"
                transition="slideUp"
                applyTo="newView"
              >
                <Scan />
              </LinkWithViewTransition>
            </div>
            <div /> {/* spacer */}
            <Button onClick={handleContinue} disabled={inputValue.isZero()}>
              Continue
            </Button>
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
