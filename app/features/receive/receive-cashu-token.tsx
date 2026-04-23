import type { Token } from '@cashu/cashu-ts';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import {
  type Location,
  type NavigateFunction,
  useLocation,
  useNavigate,
} from 'react-router';
import { useCopyToClipboard } from 'usehooks-ts';
import {
  ClosePageButton,
  PageBackButton,
  PageContent,
  PageFooter,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import { useFeatureFlag } from '~/features/shared/feature-flags';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { useToast } from '~/hooks/use-toast';
import { encodeToken } from '~/lib/cashu/token';
import type { Currency } from '~/lib/money';
import {
  LinkWithViewTransition,
  useNavigateWithViewTransition,
} from '~/lib/transitions';
import {
  accountRequiresGiftCardTermsAcceptance,
  getAccountHomePath,
} from '../accounts/account';
import { AccountSelector } from '../accounts/account-selector';
import { GiftCardItem } from '../gift-cards/gift-card-item';
import { getOfferCardImageByUrl } from '../gift-cards/offer-card-images';
import { OfferItem } from '../gift-cards/offer-item';
import { getGiftCardByUrl } from '../gift-cards/use-discover-cards';
import { tokenToMoney } from '../shared/cashu';
import { getErrorMessage } from '../shared/error';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';
import { AcceptTerms } from '../user/accept-terms';
import { useAuthActions } from '../user/auth';
import {
  pendingGiftCardMintTermsStorage,
  pendingWalletTermsStorage,
} from '../user/pending-terms-storage';
import { shouldAcceptGiftCardMintTerms } from '../user/user';
import { useAcceptTerms, useUser } from '../user/user-hooks';
import { useCreateCashuReceiveSwap } from './cashu-receive-swap-hooks';
import {
  useCashuTokenWithClaimableProofs,
  useCreateCrossAccountReceiveQuotes,
  useReceiveCashuTokenAccountPlaceholders,
  useReceiveCashuTokenAccounts,
} from './receive-cashu-token-hooks';
import {
  type CashuAccountWithTokenFlags,
  type ReceiveCashuTokenAccount,
  isClaimingToSameCashuAccount,
} from './receive-cashu-token-models';

type Props = {
  token: Token;
  /** The initially selected receive account will be set to this account if it exists.*/
  preferredReceiveAccountId?: string;
};

type ReceiveStep = 'show-claim' | 'accept-terms';

/**
 * Shared component for displaying the token amount with copy functionality
 */
function TokenAmountDisplay({
  token,
  claimableToken,
  receiveAccountCurrency,
}: {
  token: Token;
  claimableToken: Token | null;
  receiveAccountCurrency: Currency | undefined;
}) {
  const [_, copyToClipboard] = useCopyToClipboard();
  const { toast } = useToast();

  return (
    <button
      type="button"
      className="z-10 transition-transform active:scale-95"
      onClick={() => {
        copyToClipboard(
          encodeToken(claimableToken ?? token, { removeDleq: true }),
        );
        toast({
          title: 'Token copied to clipboard',
          duration: 1000,
        });
      }}
    >
      <MoneyWithConvertedAmount
        money={tokenToMoney(claimableToken ?? token)}
        otherCurrency={receiveAccountCurrency}
      />
    </button>
  );
}

/**
 * Shared component for displaying error when token cannot be claimed
 */
function TokenErrorDisplay({ message }: { message: string }) {
  return (
    <div className="mx-4 flex w-full flex-col items-center justify-center gap-2 rounded-lg border bg-card p-4">
      <AlertCircle className="h-8 w-8 text-foreground" />
      <p className="text-center text-muted-foreground text-sm">{message}</p>
    </div>
  );
}

export default function ReceiveToken({
  token,
  preferredReceiveAccountId,
}: Props) {
  const { toast } = useToast();
  const navigate = useNavigateWithViewTransition();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const { claimableToken, cannotClaimReason } =
    useCashuTokenWithClaimableProofs({ token });
  const {
    selectableAccounts,
    receiveAccount,
    sourceAccount,
    setReceiveAccount,
    addAndSetReceiveAccount,
  } = useReceiveCashuTokenAccounts(token, preferredReceiveAccountId);
  const giftCard = getGiftCardByUrl(sourceAccount.mintUrl);
  const user = useUser();
  const acceptTerms = useAcceptTerms();
  const [step, setStep] = useState<ReceiveStep>('show-claim');
  const [isAcceptingTerms, setIsAcceptingTerms] = useState(false);

  const isReceiveAccountKnown = receiveAccount?.isUnknown === false;

  const { mutateAsync: createCashuReceiveSwap } = useCreateCashuReceiveSwap();
  const { mutateAsync: createCrossAccountReceiveQuotes } =
    useCreateCrossAccountReceiveQuotes();

  const { mutate: claimTokenMutation, status: claimTokenStatus } = useMutation({
    mutationFn: async ({
      token,
      sourceAccount,
      receiveAccount,
    }: {
      token: Token;
      sourceAccount: CashuAccountWithTokenFlags;
      receiveAccount: ReceiveCashuTokenAccount;
    }) => {
      const account = receiveAccount.isUnknown
        ? await addAndSetReceiveAccount(receiveAccount)
        : receiveAccount;

      const isSameAccountClaim = isClaimingToSameCashuAccount(
        account,
        sourceAccount,
      );

      if (isSameAccountClaim) {
        const {
          swap: { transactionId },
        } = await createCashuReceiveSwap({
          token,
          accountId: account.id,
        });
        return { transactionId, account };
      }

      const result = await createCrossAccountReceiveQuotes({
        token,
        destinationAccount: account,
        sourceAccount,
      });
      return {
        transactionId: result.lightningReceiveQuote.transactionId,
        account,
      };
    },
    onSuccess: ({ transactionId, account }) => {
      const redirectTo = getAccountHomePath(account);
      navigate(
        buildLinkWithSearchParams(`/transactions/${transactionId}`, {
          showOkButton: 'true',
          redirectTo,
        }),
        {
          transition: 'fade',
          applyTo: 'newView',
        },
      );
    },
    onError: (error) => {
      console.error('Error claiming token', { cause: error });
      toast({
        title: 'Failed to claim token',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    },
  });

  // loading while the mutation is running or while waiting for navigation after mutation success
  const isClaimLoading =
    claimTokenStatus === 'pending' || claimTokenStatus === 'success';

  const runClaim = () => {
    if (!claimableToken || !receiveAccount) return;
    claimTokenMutation({
      token: claimableToken,
      sourceAccount,
      receiveAccount,
    });
  };

  const handleClaim = () => {
    if (!claimableToken || !receiveAccount) {
      return;
    }

    if (
      accountRequiresGiftCardTermsAcceptance(sourceAccount) &&
      shouldAcceptGiftCardMintTerms(user)
    ) {
      setStep('accept-terms');
      return;
    }

    runClaim();
  };

  if (step === 'accept-terms') {
    return (
      <PageContent className="justify-center">
        <AcceptTerms
          requireWalletTerms={false}
          requireGiftCardMintTerms
          onAccept={async () => {
            setIsAcceptingTerms(true);
            try {
              await acceptTerms({ giftCardTerms: true });
            } catch {
              setIsAcceptingTerms(false);
              toast({
                title: 'Failed to accept terms',
                description: 'Please try again',
                variant: 'destructive',
              });
              return;
            }
            setStep('show-claim');
            setIsAcceptingTerms(false);
            runClaim();
          }}
          onBack={() => setStep('show-claim')}
          loading={isClaimLoading || isAcceptingTerms}
        />
      </PageContent>
    );
  }

  return (
    <>
      <PageHeader className="z-10">
        <PageBackButton
          to={buildLinkWithSearchParams('/receive')}
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Receive</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center">
        <TokenAmountDisplay
          token={token}
          claimableToken={claimableToken}
          receiveAccountCurrency={receiveAccount?.currency}
        />

        <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
          {claimableToken && receiveAccount ? (
            <div className="w-full max-w-sm px-4">
              {giftCard ? (
                <div className="flex flex-col items-center gap-3">
                  <GiftCardItem
                    account={sourceAccount}
                    image={giftCard.image}
                    hideOverlayContent
                  />
                  {giftCard.addCardDisclaimer && (
                    <p className="text-center text-muted-foreground text-sm">
                      {giftCard.addCardDisclaimer}
                    </p>
                  )}
                </div>
              ) : sourceAccount.purpose === 'offer' ? (
                <OfferItem
                  account={sourceAccount}
                  image={getOfferCardImageByUrl(sourceAccount.mintUrl)}
                />
              ) : (
                <AccountSelector
                  accounts={selectableAccounts}
                  selectedAccount={receiveAccount}
                  disabled={selectableAccounts.length <= 1}
                  onSelect={setReceiveAccount}
                />
              )}
            </div>
          ) : (
            <TokenErrorDisplay
              message={
                !claimableToken
                  ? cannotClaimReason
                  : (sourceAccount.cannotReceiveReason ??
                    'Token from this mint cannot be claimed')
              }
            />
          )}
        </div>
      </PageContent>

      {claimableToken && receiveAccount && (
        <PageFooter className="pb-14">
          <Button
            disabled={receiveAccount.isSelectable === false}
            onClick={handleClaim}
            className="w-[200px]"
            loading={isClaimLoading}
          >
            {isReceiveAccountKnown ? 'Claim' : 'Add Mint and Claim'}
          </Button>
        </PageFooter>
      )}
    </>
  );
}

const addClaimToSearchParam = (
  navigate: NavigateFunction,
  location: Location,
  claimTo: 'spark' | 'cashu',
) => {
  const searchParams = new URLSearchParams(location.search);
  searchParams.set('claimTo', claimTo);
  navigate(
    {
      search: `?${searchParams.toString()}`,
      hash: location.hash,
    },
    {
      replace: true,
    },
  );
};

type PublicReceiveStep = 'show-token' | 'accept-terms';

export function PublicReceiveCashuToken({ token }: { token: Token }) {
  const [step, setStep] = useState<PublicReceiveStep>('show-token');
  const [signingUpGuest, setSigningUpGuest] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const { signUpGuest } = useAuthActions();
  const { toast } = useToast();
  const guestSignupEnabled = useFeatureFlag('GUEST_SIGNUP');
  const {
    selectableAccounts,
    receiveAccount,
    setReceiveAccount,
    sourceAccount,
  } = useReceiveCashuTokenAccountPlaceholders(token);
  const { claimableToken, cannotClaimReason } =
    useCashuTokenWithClaimableProofs({
      token,
    });

  const giftCard = getGiftCardByUrl(sourceAccount.mintUrl);
  const mintRequiresTerms =
    accountRequiresGiftCardTermsAcceptance(sourceAccount);

  const encodedToken = encodeToken(claimableToken ?? token, {
    removeDleq: true,
  });

  const handleClaimAsGuest = async () => {
    if (!claimableToken) {
      return;
    }

    setSigningUpGuest(true);
    try {
      // Store terms acceptance timestamps so they're available when user record is created
      pendingWalletTermsStorage.set(new Date().toISOString());
      if (mintRequiresTerms) {
        pendingGiftCardMintTermsStorage.set(new Date().toISOString());
      }

      // Modify the URL before signing up because as soon as the user is logged in,
      // they will be redirected to the protected receive cashu token page
      addClaimToSearchParam(navigate, location, receiveAccount.type);

      await signUpGuest();

      // We are not setting signingUpGuest to false here because the navigation
      // after signup will trigger a new render and the component will unmount.
      // If we would set it to false here, the component would show clickable
      // button for a brief moment before the navigation is complete (awaiting
      // navigate to complete is not enough for some reason).
    } catch (error) {
      console.error('Error signing up guest', { cause: error });
      toast({
        title: 'Failed to create guest account',
        description: 'Please try again or contact support',
        variant: 'destructive',
      });
      setSigningUpGuest(false);
    }
  };

  if (step === 'accept-terms') {
    return (
      <>
        <PageContent className="justify-center">
          <AcceptTerms
            requireWalletTerms
            requireGiftCardMintTerms={mintRequiresTerms}
            onAccept={handleClaimAsGuest}
            onBack={() => setStep('show-token')}
            loading={signingUpGuest}
          />
        </PageContent>
      </>
    );
  }

  return (
    <>
      <PageHeader className="z-10">
        <ClosePageButton to="/home" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Receive</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center">
        <TokenAmountDisplay
          token={token}
          claimableToken={claimableToken}
          receiveAccountCurrency={sourceAccount.currency}
        />

        <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
          {claimableToken && sourceAccount.canReceive ? (
            <div className="w-full max-w-sm px-4">
              {giftCard ? (
                <div className="flex flex-col items-center gap-3">
                  <GiftCardItem
                    account={sourceAccount}
                    image={giftCard.image}
                    hideOverlayContent
                  />
                  {giftCard.addCardDisclaimer && (
                    <p className="text-center text-muted-foreground text-sm">
                      {giftCard.addCardDisclaimer}
                    </p>
                  )}
                </div>
              ) : sourceAccount.purpose === 'offer' ? (
                <OfferItem
                  account={sourceAccount}
                  image={getOfferCardImageByUrl(sourceAccount.mintUrl)}
                />
              ) : (
                <AccountSelector
                  accounts={selectableAccounts}
                  selectedAccount={receiveAccount}
                  disabled={selectableAccounts.length <= 1}
                  onSelect={setReceiveAccount}
                />
              )}
            </div>
          ) : (
            <TokenErrorDisplay
              message={
                !claimableToken
                  ? cannotClaimReason
                  : (sourceAccount.cannotReceiveReason ??
                    'Token from this mint cannot be claimed')
              }
            />
          )}
        </div>
      </PageContent>

      {claimableToken && sourceAccount.canReceive && (
        <PageFooter className="pb-14">
          <div className="flex flex-col gap-4">
            {guestSignupEnabled && (
              <Button
                onClick={() => setStep('accept-terms')}
                loading={signingUpGuest}
                className="w-[200px]"
              >
                Claim as Guest
              </Button>
            )}

            <LinkWithViewTransition
              to={{
                ...buildLinkWithSearchParams('/login', {
                  redirectTo: '/receive/cashu/token',
                  ...(mintRequiresTerms && {
                    requireGiftCardMintTerms: 'true',
                  }),
                }),
                hash: encodedToken,
              }}
              transition="slideUp"
              applyTo="newView"
            >
              <Button className="w-[200px]">Log In and Claim</Button>
            </LinkWithViewTransition>
          </div>
        </PageFooter>
      )}
    </>
  );
}
