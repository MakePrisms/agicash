import { getEncodedToken } from '@cashu/cashu-ts';
import { useState } from 'react';
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
import { Card, CardContent } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { Skeleton } from '~/components/ui/skeleton';
import { useCreateLockedToken } from '~/features/locked-tokens';
import { MerchantShareCashuToken, useMerchantStore } from '~/features/merchant';
import { CARD_CODE_LENGTH } from '~/features/merchant/merchant-store';
import {
  useCashuSendSwap,
  useTrackCashuSendSwap,
} from '~/features/send/cashu-send-swap-hooks';
import { useUser } from '~/features/user/user-hooks';
import useAnimation from '~/hooks/use-animation';
import { useEffectNoStrictMode } from '~/hooks/use-effect-no-strict-mode';
import useUserAgent from '~/hooks/use-user-agent';
import { getCashuProtocolUnit } from '~/lib/cashu';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import type { Route } from './+types/_protected.merchant.share.$swapId';

/**
 * Inner component that handles the swap tracking and locked token creation.
 * Only rendered when we have cardCode and privateKey available.
 */
function MerchantShareWithTracking({
  swapId,
  cardCode,
  privateKey,
}: {
  swapId: string;
  cardCode: string;
  privateKey: string;
}) {
  const navigate = useNavigateWithViewTransition();
  const user = useUser();
  const { data: swap } = useCashuSendSwap(swapId);
  const {
    mutate: createLockedToken,
    data: lockedTokenData,
    isPending: isCreatingLockedToken,
    status: createLockedTokenStatus,
  } = useCreateLockedToken();
  const [hasInitiatedTokenCreation, setHasInitiatedTokenCreation] =
    useState(false);

  const { swap: trackingSwap, status } = useTrackCashuSendSwap({
    id: swapId,
    onCompleted: (swap) => {
      navigate(`/transactions/${swap.transactionId}?redirectTo=/`, {
        transition: 'fade',
        applyTo: 'newView',
      });
    },
  });

  useEffectNoStrictMode(() => {
    if (status === 'DISABLED') return;

    if (
      trackingSwap?.state === 'PENDING' &&
      !hasInitiatedTokenCreation &&
      createLockedTokenStatus === 'idle'
    ) {
      const token = {
        mint: trackingSwap.account.mintUrl,
        proofs: trackingSwap.proofsToSend,
        unit: getCashuProtocolUnit(trackingSwap.inputAmount.currency),
      };

      console.log(getEncodedToken(token));

      setHasInitiatedTokenCreation(true);
      createLockedToken({
        token,
        accessCode: cardCode,
        userId: user.id,
      });
    }
  }, [
    trackingSwap,
    cardCode,
    user.id,
    status,
    createLockedTokenStatus,
    hasInitiatedTokenCreation,
    createLockedToken,
  ]);

  // Show loading state while preparing the locked token
  if (swap.state === 'PENDING' && (!lockedTokenData || isCreatingLockedToken)) {
    return (
      <Page>
        <PageHeader className="z-10">
          <ClosePageButton
            to="/merchant"
            transition="slideRight"
            applyTo="oldView"
          />
          <PageHeaderTitle>Merchant Payment</PageHeaderTitle>
        </PageHeader>
        <PageContent className="flex flex-col items-center gap-4">
          <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
            <Card className="m-4 w-full">
              <CardContent className="flex flex-col gap-6 pt-6">
                <div className="text-center">
                  <p className="text-muted-foreground">
                    {isCreatingLockedToken
                      ? 'Securing payment...'
                      : 'Preparing payment...'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </PageContent>
      </Page>
    );
  }

  // At this point we should have the locked token data
  if (!lockedTokenData) {
    return (
      <Page>
        <PageHeader className="z-10">
          <ClosePageButton
            to="/merchant"
            transition="slideRight"
            applyTo="oldView"
          />
          <PageHeaderTitle>Merchant Payment</PageHeaderTitle>
        </PageHeader>
        <PageContent className="flex flex-col items-center gap-4">
          <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
            <Card className="m-4 w-full">
              <CardContent className="flex flex-col gap-6 pt-6">
                <div className="text-center">
                  <p className="text-muted-foreground">
                    Payment setup incomplete. Please try again.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </PageContent>
      </Page>
    );
  }

  return (
    <MerchantShareCashuToken
      tokenHash={lockedTokenData.tokenHash}
      cardCode={cardCode}
      privateKey={privateKey}
    />
  );
}

/**
 * Component that prompts user to enter card code when it's missing
 */
function CardCodePrompt({
  swapId,
  privateKey,
}: {
  swapId: string;
  privateKey: string | undefined;
}) {
  const { animationClass: shakeAnimationClass, start: startShakeAnimation } =
    useAnimation({ name: 'shake' });
  const { isMobile } = useUserAgent();

  const [localCardCode, setLocalCardCode] = useState('');
  const cardCode = useMerchantStore((s) => s.cardCode);
  const setCode = useMerchantStore((s) => s.setCode);

  // Once cardCode is set in store, render the tracking component
  if (cardCode.length === CARD_CODE_LENGTH && privateKey) {
    return (
      <MerchantShareWithTracking
        swapId={swapId}
        cardCode={cardCode}
        privateKey={privateKey}
      />
    );
  }

  /**
   * Handle form submission - validate and set code in store
   */
  const handleSubmit = () => {
    if (localCardCode.length !== CARD_CODE_LENGTH) {
      startShakeAnimation();
      return;
    }
    setCode(localCardCode);
  };

  /**
   * Handle numpad input for mobile
   */
  const handleNumpadInput = (value: string) => {
    if (value === 'backspace') {
      setLocalCardCode((prev) => prev.slice(0, -1));
    } else if (value === 'clear') {
      setLocalCardCode('');
    } else if (localCardCode.length < CARD_CODE_LENGTH && /^\d$/.test(value)) {
      setLocalCardCode((prev) => prev + value);
    } else {
      startShakeAnimation();
    }
  };

  /**
   * Handle desktop input change
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, ''); // Only allow digits
    if (value.length <= CARD_CODE_LENGTH) {
      setLocalCardCode(value);
    }
  };

  return (
    <Page>
      <PageHeader className="z-10">
        <ClosePageButton
          to="/merchant"
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Enter Card Code</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center gap-6">
        <div className="text-center">
          <p className="text-muted-foreground">
            Please enter the 4-digit card code to continue
          </p>
        </div>

        <div
          className={`flex w-full max-w-sm flex-col gap-4 sm:max-w-none ${shakeAnimationClass}`}
        >
          <Input
            id="cardCode"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={CARD_CODE_LENGTH}
            className="text-center font-numeric text-2xl"
            placeholder="Enter card code"
            value={localCardCode}
            readOnly={isMobile}
            onChange={isMobile ? undefined : handleInputChange}
          />

          {!isMobile && (
            <Button
              onClick={handleSubmit}
              disabled={localCardCode.length !== CARD_CODE_LENGTH}
              className="w-full"
            >
              Continue
            </Button>
          )}
        </div>
      </PageContent>
      <PageFooter className="sm:pb-14">
        {isMobile && (
          <div className="flex flex-col gap-4">
            <Button
              onClick={handleSubmit}
              disabled={localCardCode.length !== CARD_CODE_LENGTH}
              className="w-full"
            >
              Continue
            </Button>
            <Numpad showDecimal={false} onButtonClick={handleNumpadInput} />
          </div>
        )}
      </PageFooter>
    </Page>
  );
}

/**
 * Parent component that handles prerequisites before rendering the tracking component
 */
export default function MerchantShare({ params }: Route.ComponentProps) {
  const { data: swap } = useCashuSendSwap(params.swapId);
  const cardCode = useMerchantStore((s) => s.cardCode);
  const privateKey =
    swap.unlockingData && swap.unlockingData.kind === 'P2PK'
      ? swap.unlockingData.signingKeys[0]
      : undefined;

  // Show skeleton for non-pending/non-completed swaps
  if (swap.state !== 'PENDING' && swap.state !== 'COMPLETED') {
    return (
      <Page>
        <PageHeader className="z-10">
          <ClosePageButton
            to="/merchant"
            transition="slideRight"
            applyTo="oldView"
          />
          <PageHeaderTitle>Merchant Payment</PageHeaderTitle>
        </PageHeader>
        <PageContent className="flex flex-col items-center gap-4">
          <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
            <Card className="m-4 w-full">
              <CardContent className="flex flex-col gap-6 pt-6">
                {/* Payment Details Skeleton - Minimal */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-sm">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>

                <Skeleton className="h-px w-full opacity-30" />

                {/* Gift Link Section Skeleton - Main CTA */}
                <div className="space-y-4">
                  <div className="space-y-2 text-center">
                    <Skeleton className="mx-auto h-6 w-32" />
                    <Skeleton className="mx-auto h-4 w-48" />
                  </div>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-11 w-full" />
                </div>

                {/* Private Key Section Skeleton - Very Minimal */}
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          </div>
        </PageContent>
      </Page>
    );
  }

  // If cardCode is missing, show inline card code prompt
  if (!cardCode) {
    return <CardCodePrompt swapId={params.swapId} privateKey={privateKey} />;
  }

  // If privateKey is missing, show error
  if (!privateKey) {
    return (
      <Page>
        <PageHeader className="z-10">
          <ClosePageButton
            to="/merchant"
            transition="slideRight"
            applyTo="oldView"
          />
          <PageHeaderTitle>Merchant Payment</PageHeaderTitle>
        </PageHeader>
        <PageContent className="flex flex-col items-center gap-4">
          <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
            <Card className="m-4 w-full">
              <CardContent className="flex flex-col gap-6 pt-6">
                <div className="text-center">
                  <p className="text-muted-foreground">
                    Payment keys missing. Please try again.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </PageContent>
      </Page>
    );
  }

  // Now we have both cardCode and privateKey, render the component with tracking
  return (
    <MerchantShareWithTracking
      swapId={params.swapId}
      cardCode={cardCode}
      privateKey={privateKey}
    />
  );
}
