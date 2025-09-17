import { ArrowUpDown } from 'lucide-react';
import { MoneyDisplay, MoneyInputDisplay } from '~/components/money-display';
import { Numpad } from '~/components/numpad';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { useAccounts } from '~/features/accounts/account-hooks';
import { AccountSelector } from '~/features/accounts/account-selector';
import { useMerchantStore } from '~/features/merchant';
import { getDefaultUnit } from '~/features/shared/currencies';
import { DomainError, getErrorMessage } from '~/features/shared/error';
import useAnimation from '~/hooks/use-animation';
import { useMoneyInput } from '~/hooks/use-money-input';
import { useToast } from '~/hooks/use-toast';
import type { Money } from '~/lib/money';
import { useNavigateWithViewTransition } from '~/lib/transitions';

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
        variant="secondary"
      />
      <ArrowUpDown className="mb-1" />
    </button>
  );
};

export default function MerchantAmountInput() {
  const navigate = useNavigateWithViewTransition();
  const { toast } = useToast();
  const { animationClass: shakeAnimationClass, start: startShakeAnimation } =
    useAnimation({ name: 'shake' });
  const { data: accounts } = useAccounts();

  const status = useMerchantStore((s) => s.status);
  const getQuote = useMerchantStore((s) => s.getQuote);
  const receiveAccount = useMerchantStore((s) => s.getSourceAccount());
  const setReceiveAccount = useMerchantStore((s) => s.setAccount);

  const {
    rawInputValue,
    maxInputDecimals,
    inputValue,
    convertedValue,
    exchangeRateError,
    handleNumberInput,
    switchInputCurrency,
  } = useMoneyInput({
    initialRawInputValue: '0',
    initialInputCurrency: receiveAccount.currency,
    initialOtherCurrency: receiveAccount.currency === 'BTC' ? 'USD' : 'BTC',
  });

  const handleNext = async () => {
    if (inputValue.isZero()) return;

    // Determine the amount to use for the quote
    let amountToQuote = inputValue;
    if (inputValue.currency !== receiveAccount.currency) {
      if (!convertedValue) {
        // Can't happen because when there is no converted value, the toggle will not be shown so input currency and receive currency must be the same
        return;
      }
      amountToQuote = convertedValue;
    }

    // validate the input and that we have sufficient funds
    const result = await getQuote(amountToQuote, true);
    if (!result.success) {
      const toastOptions =
        result.error instanceof DomainError
          ? { description: result.error.message }
          : {
              title: 'Error',
              description: getErrorMessage(
                result.error,
                'Failed to get quote. Please try again.',
              ),
              variant: 'destructive' as const,
            };
      toast(toastOptions);
      return;
    }

    navigate('/merchant/card-code', {
      transition: 'slideLeft',
      applyTo: 'newView',
    });
  };

  return (
    <Page>
      <PageHeader>
        <ClosePageButton to="/" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Merchant</PageHeaderTitle>
      </PageHeader>

      <PageContent className="flex w-full flex-col items-center justify-between">
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
            accounts={accounts}
            selectedAccount={receiveAccount}
            onSelect={(account) => {
              setReceiveAccount(account);
              if (account.currency !== inputValue.currency) {
                switchInputCurrency();
              }
            }}
          />
        </div>

        <div className="flex w-full flex-col items-center gap-4 sm:items-start sm:justify-between">
          <div className="grid w-full max-w-sm grid-cols-3 gap-4 sm:max-w-none">
            <div /> {/* spacer */}
            <div /> {/* spacer */}
            <Button
              onClick={handleNext}
              disabled={inputValue.isZero()}
              loading={status === 'quoting'}
            >
              Next
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
    </Page>
  );
}
