import { MoneyInputDisplay } from '~/components/money-display';
import { Numpad } from '~/components/numpad';
import {
  ClosePageButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderItem,
  PageHeaderTitle,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import {
  AccountSelector,
  toAccountSelectorOption,
} from '~/features/accounts/account-selector';
import { accountOfflineToast } from '~/features/accounts/utils';
import { ConvertedMoneySwitcher } from '~/features/shared/converted-money-switcher';
import { getDefaultUnit } from '~/features/shared/currencies';
import { DomainError } from '~/features/shared/error';
import useAnimation from '~/hooks/use-animation';
import { useMoneyInput } from '~/hooks/use-money-input';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useToast } from '~/hooks/use-toast';
import type { Money } from '~/lib/money';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import { useAccount, useAccounts } from '../accounts/account-hooks';
import { BuyFaqDrawer } from './buy-faq-drawer';
import { useBuyStore } from './buy-provider';
import { CashAppLogo } from './cash-app';

export default function BuyInput() {
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const { toast } = useToast();
  const { redirectTo } = useRedirectTo('/');
  const { animationClass: shakeAnimationClass, start: startShakeAnimation } =
    useAnimation({ name: 'shake' });

  const buyAccountId = useBuyStore((s) => s.accountId);
  const buyAccount = useAccount(buyAccountId);
  const buyAmount = useBuyStore((s) => s.amount);
  const buyCurrencyUnit = getDefaultUnit(buyAccount.currency);
  const setBuyAccount = useBuyStore((s) => s.setAccount);
  const getBuyQuote = useBuyStore((s) => s.getBuyQuote);
  const status = useBuyStore((s) => s.status);
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
    initialRawInputValue: buyAmount?.toString(buyCurrencyUnit) || '0',
    initialInputCurrency: buyAccount.currency,
    initialOtherCurrency: buyAccount.currency === 'BTC' ? 'USD' : 'BTC',
  });

  const handleContinue = async () => {
    if (!buyAccount.isOnline) {
      toast(accountOfflineToast);
      return;
    }

    let amount: Money;
    if (inputValue.currency === buyAccount.currency) {
      amount = inputValue;
    } else {
      if (!convertedValue) {
        return;
      }
      amount = convertedValue;
    }

    const result = await getBuyQuote(amount);

    if (!result.success) {
      if (result.error instanceof DomainError) {
        toast({ description: result.error.message });
      } else {
        console.error('Failed to create invoice', { cause: result.error });
        toast({
          description: 'Failed to create invoice. Please try again.',
          variant: 'destructive',
        });
      }
      return;
    }

    navigate(buildLinkWithSearchParams('/buy/checkout'), {
      transition: 'slideLeft',
      applyTo: 'newView',
    });
  };

  return (
    <>
      <PageHeader>
        <ClosePageButton
          to={{ pathname: redirectTo, search: '' }}
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>Buy</PageHeaderTitle>
        <PageHeaderItem position="right">
          <BuyFaqDrawer />
        </PageHeaderItem>
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
              onSwitch={switchInputCurrency}
              money={convertedValue}
            />
          )}
        </div>

        <div className="w-full max-w-sm sm:max-w-none">
          <AccountSelector
            accounts={accounts.map((account) =>
              toAccountSelectorOption(account),
            )}
            selectedAccount={toAccountSelectorOption(buyAccount)}
            onSelect={(account) => {
              setBuyAccount(account);
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
              <span className="ml-1 flex items-center gap-2 whitespace-nowrap text-sm">
                Pay with
                <CashAppLogo className="-translate-y-[0.5px] h-5" />
              </span>
            </div>
            <div />
            <div className="flex items-center justify-end">
              <Button
                onClick={handleContinue}
                disabled={inputValue.isZero()}
                loading={status === 'quoting' || status === 'success'}
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
