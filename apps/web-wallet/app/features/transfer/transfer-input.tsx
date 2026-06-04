import { Clipboard, Scan } from 'lucide-react';
import { useState } from 'react';
import { MoneyInputDisplay } from '~/components/money-display';
import { Numpad } from '~/components/numpad';
import {
  PageBackButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import { accountOfflineToast } from '~/features/accounts/utils';
import { ConvertedMoneySwitcher } from '~/features/shared/converted-money-switcher';
import { getDefaultUnit } from '~/features/shared/currencies';
import { DomainError } from '~/features/shared/error';
import useAnimation from '~/hooks/use-animation';
import { useMoneyInput } from '~/hooks/use-money-input';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
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
  const { redirectTo } = useRedirectTo('/');
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const { toast } = useToast();
  const { animationClass: shakeAnimationClass, start: startShakeAnimation } =
    useAnimation({ name: 'shake' });
  const [isContinuing, setIsContinuing] = useState(false);

  const sourceAccountId = useTransferStore((s) => s.sourceAccountId);
  const sourceAccount = useAccount(sourceAccountId);
  const destinationAccountId = useTransferStore((s) => s.destinationAccountId);
  const amount = useTransferStore((s) => s.amount);
  const currencyUnit = getDefaultUnit(sourceAccount.currency);
  const getTransferQuote = useTransferStore((s) => s.getTransferQuote);
  const status = useTransferStore((s) => s.status);

  const {
    rawInputValue,
    maxInputDecimals,
    inputValue,
    convertedValue,
    exchangeRateError,
    handleNumberInput,
    switchInputCurrency,
  } = useMoneyInput({
    initialRawInputValue: amount?.toString(currencyUnit) || '0',
    initialInputCurrency: sourceAccount.currency,
    initialOtherCurrency: sourceAccount.currency === 'BTC' ? 'USD' : 'BTC',
  });

  const handleContinue = async () => {
    if (!sourceAccount.isOnline) {
      toast(accountOfflineToast);
      return;
    }

    let transferAmount: Money;
    if (inputValue.currency === sourceAccount.currency) {
      transferAmount = inputValue;
    } else {
      if (!convertedValue) {
        // Can't happen because when there is no converted value, the toggle will not be shown so input currency and source currency must be the same
        return;
      }
      transferAmount = convertedValue;
    }

    setIsContinuing(true);
    const result = await getTransferQuote(transferAmount);

    if (!result.success) {
      setIsContinuing(false);
      if (result.error instanceof DomainError) {
        toast({ description: result.error.message });
      } else {
        console.error('Failed to get transfer quote', { cause: result.error });
        toast({
          description: 'Failed to create transfer. Please try again.',
          variant: 'destructive',
        });
      }
      return;
    }

    navigate(
      buildLinkWithSearchParams(`/transfer/${destinationAccountId}/confirm`),
      {
        transition: 'slideLeft',
        applyTo: 'newView',
      },
    );
  };

  const handlePaste = async () => {
    const clipboardContent = await readClipboard();
    if (!clipboardContent) {
      return;
    }

    const encodedToken = extractCashuToken(clipboardContent)?.encoded;
    if (!encodedToken) {
      toast({
        title: 'Invalid input',
        description: 'Please paste a valid cashu token',
        variant: 'destructive',
      });
      return;
    }

    const hash = `#${encodedToken}`;

    // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
    // See https://github.com/remix-run/remix/discussions/10721
    window.history.replaceState(null, '', hash);
    navigate(
      {
        ...buildLinkWithSearchParams('/receive/cashu/token', {
          selectedAccountId: destinationAccountId,
        }),
        hash,
      },
      { transition: 'slideLeft', applyTo: 'newView' },
    );
  };

  return (
    <>
      <PageHeader>
        <PageBackButton
          to={redirectTo}
          transition="slideRight"
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

        <div className="flex w-full flex-col items-center gap-4 sm:items-start sm:justify-between">
          <div className="grid w-full max-w-sm grid-cols-3 gap-4 sm:max-w-none">
            <div className="flex items-center justify-start gap-4">
              <button type="button" onClick={handlePaste}>
                <Clipboard />
              </button>

              <LinkWithViewTransition
                to={buildLinkWithSearchParams(
                  `/transfer/${destinationAccountId}/scan`,
                )}
                transition="slideUp"
                applyTo="newView"
              >
                <Scan />
              </LinkWithViewTransition>
            </div>
            <div />
            <Button
              onClick={handleContinue}
              disabled={inputValue.isZero()}
              loading={status === 'quoting' || isContinuing}
            >
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
