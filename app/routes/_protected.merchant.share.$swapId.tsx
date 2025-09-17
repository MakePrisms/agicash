import { getEncodedToken } from '@cashu/cashu-ts';
import { useState } from 'react';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Card, CardContent } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { useCreateLockedToken } from '~/features/locked-tokens';
import { MerchantShareCashuToken, useMerchantStore } from '~/features/merchant';
import {
  useCashuSendSwap,
  useTrackCashuSendSwap,
} from '~/features/send/cashu-send-swap-hooks';
import { useUser } from '~/features/user/user-hooks';
import { useEffectNoStrictMode } from '~/hooks/use-effect-no-strict-mode';
import { getCashuProtocolUnit } from '~/lib/cashu';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import type { Route } from './+types/_protected.merchant.share.$swapId';

/**
 * Loading skeleton component shown while locked token is being created
 */
function LoadingSkeleton() {
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
                <p className="mb-4 text-muted-foreground">
                  Securing payment...
                </p>
              </div>

              {/* Payment Details Skeleton */}
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

              {/* Gift Link Section Skeleton */}
              <div className="space-y-4">
                <div className="space-y-2 text-center">
                  <Skeleton className="mx-auto h-6 w-32" />
                  <Skeleton className="mx-auto h-4 w-48" />
                </div>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            </CardContent>
          </Card>
        </div>
      </PageContent>
    </Page>
  );
}

/**
 * Main merchant share component with simplified state management
 */
export default function MerchantShare({ params }: Route.ComponentProps) {
  const navigate = useNavigateWithViewTransition();
  const user = useUser();
  const { data: swap } = useCashuSendSwap(params.swapId);
  const cardCode = useMerchantStore((s) => s.cardCode);

  const {
    mutate: createLockedToken,
    data: lockedTokenData,
    isPending: isCreatingLockedToken,
    status: createLockedTokenStatus,
  } = useCreateLockedToken();
  const [hasInitiatedTokenCreation, setHasInitiatedTokenCreation] =
    useState(false);

  const { swap: trackingSwap, status } = useTrackCashuSendSwap({
    id: params.swapId,
    onCompleted: (swap) => {
      navigate(`/transactions/${swap.transactionId}?redirectTo=/`, {
        transition: 'fade',
        applyTo: 'newView',
      });
    },
  });

  const privateKey =
    swap.unlockingData && swap.unlockingData.kind === 'P2PK'
      ? swap.unlockingData.signingKeys[0]
      : undefined;

  // Create locked token when swap is pending
  useEffectNoStrictMode(() => {
    if (status === 'DISABLED') return;
    if (!privateKey) return;

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
    privateKey,
  ]);

  // Show loading skeleton while locked token is being created or swap is not ready
  if (
    (swap.state !== 'PENDING' && swap.state !== 'COMPLETED') ||
    !privateKey ||
    (swap.state === 'PENDING' && (!lockedTokenData || isCreatingLockedToken))
  ) {
    return <LoadingSkeleton />;
  }

  // Show error if locked token creation failed
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

  // Show the merchant share screen
  return (
    <MerchantShareCashuToken
      tokenHash={lockedTokenData.tokenHash}
      cardCode={cardCode}
      privateKey={privateKey}
      swap={swap}
    />
  );
}
