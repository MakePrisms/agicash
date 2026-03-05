import { getEncodedToken } from '@cashu/cashu-ts';
import { Clipboard, Scan } from 'lucide-react';
import { MoneyInputDisplay } from '~/components/money-display';
import { Numpad } from '~/components/numpad';
import {
  ClosePageButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import { ConvertedMoneySwitcher } from '~/features/shared/converted-money-switcher';
import { getDefaultUnit } from '~/features/shared/currencies';
import { DomainError } from '~/features/shared/error';
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
import { useAccount } from '../accounts/account-hooks';
import { useTransferStore } from './transfer-provider';

export default function TransferInput() {
  const navigate = useNavigateWithViewTransition();
  const { toast } = useToast();
  const { animationClass: shakeAnimationClass, start: startShakeAnimation } =
    useAnimation({ name: 'shake' });

  const destinationAccountId = useTransferStore((s) => s.destinationAccountId);
  const getTransferQuote = useTransferStore((s) => s.getTransferQuote);
  const status = useTransferStore((s) => s.status);

  const destinationAccount = useAccount(destinationAccountId);

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
    initialInputCurrency: destinationAccount.currency,
    initialOtherCurrency: destinationAccount.currency === 'BTC' ? 'USD' : 'BTC',
  });

  const handleContinue = async () => {
    let amount: Money;
    if (inputValue.currency === destinationAccount.currency) {
      amount = inputValue;
    } else {
      if (!convertedValue) {
        return;
      }
      amount = convertedValue;
    }

    if (amount.isZero()) return;

    const result = await getTransferQuote(amount);

    if (!result.success) {
      if (result.error instanceof DomainError) {
        toast({ description: result.error.message });
      } else {
        console.error('Failed to get transfer quote', { cause: result.error });
        toast({
          description: 'Failed to get quote. Please try again.',
          variant: 'destructive',
        });
      }
      return;
    }

    navigate('confirm', {
      transition: 'slideLeft',
      applyTo: 'newView',
    });
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

    window.history.replaceState(null, '', hash);
    navigate(
      {
        pathname: '/receive/cashu/token',
        search: new URLSearchParams({
          selectedAccountId: destinationAccount.id,
          redirectTo: `/gift-cards/${destinationAccount.id}`,
        }).toString(),
        hash,
      },
      { transition: 'slideLeft', applyTo: 'newView' },
    );
  };

  return (
    <>
      <PageHeader>
        <ClosePageButton
          to={`/gift-cards/${destinationAccount.id}`}
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>Add</PageHeaderTitle>
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

        <div className="flex w-full max-w-sm flex-col items-center gap-4 sm:max-w-none sm:items-start sm:justify-between">
          <div className="grid w-full max-w-sm grid-cols-3 gap-4 sm:max-w-none">
            <div className="flex items-center justify-start gap-4">
              <button type="button" onClick={handlePaste}>
                <Clipboard className="h-5 w-5 text-muted-foreground" />
              </button>
              <LinkWithViewTransition
                to={{
                  pathname: '/receive/scan',
                  search: new URLSearchParams({
                    accountId: destinationAccount.id,
                    redirectTo: `/gift-cards/${destinationAccount.id}`,
                  }).toString(),
                }}
                transition="slideUp"
                applyTo="newView"
              >
                <Scan className="h-5 w-5 text-muted-foreground" />
              </LinkWithViewTransition>
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
