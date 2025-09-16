import { useMemo } from 'react';
import { MoneyInputDisplay } from '~/components/money-display';
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
import { useMerchantStore } from '~/features/merchant';
import { getDefaultUnit } from '~/features/shared/currencies';
import { DomainError, getErrorMessage } from '~/features/shared/error';
import useAnimation from '~/hooks/use-animation';
import { useMoneyInput } from '~/hooks/use-money-input';
import { useToast } from '~/hooks/use-toast';
import { useNavigateWithViewTransition } from '~/lib/transitions';

export default function MerchantAmountInput() {
  const navigate = useNavigateWithViewTransition();
  const { toast } = useToast();
  const { animationClass: shakeAnimationClass, start: startShakeAnimation } =
    useAnimation({ name: 'shake' });

  const status = useMerchantStore((s) => s.status);
  const getQuote = useMerchantStore((s) => s.getQuote);

  const { rawInputValue, maxInputDecimals, inputValue, handleNumberInput } =
    useMoneyInput({
      initialRawInputValue: '0',
      initialInputCurrency: 'BTC',
      initialOtherCurrency: 'USD',
    });

  const unit = useMemo(
    () => getDefaultUnit(inputValue.currency),
    [inputValue.currency],
  );

  const handleNext = async () => {
    if (inputValue.isZero()) return;

    // validate the input and that we have sufficient funds
    const result = await getQuote(inputValue, true);
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
      <PageContent className="mx-auto flex flex-col items-center gap-6">
        <div className="flex h-[124px] flex-col items-center gap-2">
          <div className={shakeAnimationClass}>
            <MoneyInputDisplay
              inputValue={rawInputValue}
              currency={inputValue.currency}
              unit={unit}
            />
          </div>
        </div>
      </PageContent>
      <PageFooter className="sm:pb-14">
        <div className="flex w-full flex-col gap-4">
          <div className="grid w-full max-w-sm grid-cols-3 gap-4 sm:max-w-none">
            <div /> {/* spacer */}
            <div /> {/* spacer */}
            <Button
              onClick={handleNext}
              disabled={inputValue.isZero()}
              loading={status === 'quoting'}
              className="w-full"
            >
              Next
            </Button>
          </div>
          <Numpad
            showDecimal={maxInputDecimals > 0}
            onButtonClick={(value) => {
              handleNumberInput(value, startShakeAnimation);
            }}
          />
        </div>
      </PageFooter>
    </Page>
  );
}
