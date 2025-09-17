import { MoneyInputDisplay } from '~/components/money-display';
import { Numpad } from '~/components/numpad';
import {
  Page,
  PageBackButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Redirect } from '~/components/redirect';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { useMerchantStore } from '~/features/merchant';
import { CARD_CODE_LENGTH } from '~/features/merchant/merchant-store';
import { useCreateCashuSendSwap } from '~/features/send/cashu-send-swap-hooks';
import { getDefaultUnit } from '~/features/shared/currencies';
import { DomainError, getErrorMessage } from '~/features/shared/error';
import useAnimation from '~/hooks/use-animation';
import { useToast } from '~/hooks/use-toast';
import useUserAgent from '~/hooks/use-user-agent';
import { generateRandomKeyPair } from '~/lib/secp256k1';
import { useNavigateWithViewTransition } from '~/lib/transitions';

function MerchantCardCode() {
  const navigate = useNavigateWithViewTransition();
  const { animationClass: shakeAnimationClass, start: startShakeAnimation } =
    useAnimation({ name: 'shake' });
  const { toast } = useToast();
  const { isMobile } = useUserAgent();

  const amount = useMerchantStore((s) => s.amount);
  const quote = useMerchantStore((s) => s.quote);
  const cardCode = useMerchantStore((s) => s.cardCode);
  const setCode = useMerchantStore((s) => s.setCode);
  const handleCodeInput = useMerchantStore((s) => s.handleCodeInput);
  const account = useMerchantStore((s) => s.getSourceAccount());

  const { mutate: createCashuSendSwap, status: createSwapStatus } =
    useCreateCashuSendSwap({
      onSuccess: (swap) => {
        navigate(`/merchant/share/${swap.id}`, {
          transition: 'slideLeft',
          applyTo: 'newView',
        });
      },
      onError: (error) => {
        const toastOptions =
          error instanceof DomainError
            ? { description: error.message }
            : {
                title: 'Error',
                description: getErrorMessage(
                  error,
                  'Failed to create cashu send swap. Please try again.',
                ),
                variant: 'destructive' as const,
              };
        toast(toastOptions);
      },
    });

  if (!amount || !quote) {
    return (
      <Redirect
        to="/merchant"
        logMessage="No amount or quote set for merchant"
      />
    );
  }

  const handleGenerate = () => {
    if (!quote || cardCode.length !== CARD_CODE_LENGTH) return;

    const { privateKey, publicKey } = generateRandomKeyPair({ asBytes: false });
    createCashuSendSwap({
      amount: quote.amountRequested,
      accountId: account.id,
      type: 'GIFT',
      spendingConditionData: {
        kind: 'P2PK',
        data: publicKey,
        conditions: null,
      },
      unlockingData: {
        kind: 'P2PK',
        signingKeys: [privateKey],
      },
    });
  };

  const unit = getDefaultUnit(amount.currency);

  return (
    <Page>
      <PageHeader>
        <PageBackButton
          to="/merchant"
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Code</PageHeaderTitle>
      </PageHeader>

      <PageContent className="mx-auto flex flex-col items-center justify-between">
        <div className="flex h-[124px] flex-col items-center gap-2">
          <MoneyInputDisplay
            inputValue={amount.toString(unit)}
            currency={amount.currency}
            unit={unit}
          />
        </div>

        <div className="flex justify-center">
          <div className={`w-48 ${shakeAnimationClass}`}>
            <Input
              id="cardCode"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={CARD_CODE_LENGTH}
              className="text-center font-primary"
              placeholder="Enter card code"
              value={cardCode}
              readOnly={isMobile}
              onChange={isMobile ? undefined : (e) => setCode(e.target.value)}
            />
          </div>
        </div>

        <div className="flex w-full flex-col items-center gap-4 sm:items-start sm:justify-between">
          <div className="grid w-full max-w-sm grid-cols-3 gap-4 sm:max-w-none">
            <div /> {/* spacer */}
            <div /> {/* spacer */}
            <Button
              onClick={handleGenerate}
              disabled={cardCode.length !== CARD_CODE_LENGTH}
              loading={['pending', 'success'].includes(createSwapStatus)}
            >
              Generate
            </Button>
          </div>
        </div>
      </PageContent>
      <PageFooter className="sm:pb-14">
        {isMobile && (
          <Numpad
            showDecimal={false}
            onButtonClick={(value) => {
              handleCodeInput(value, startShakeAnimation);
            }}
          />
        )}
      </PageFooter>
    </Page>
  );
}

export default MerchantCardCode;
