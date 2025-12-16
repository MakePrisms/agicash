import {
  MintOperationError,
  type Token,
  getEncodedToken,
} from '@cashu/cashu-ts';
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
import { useToast } from '~/hooks/use-toast';
import { useFeatureFlag } from '~/lib/feature-flags';
import type { Currency } from '~/lib/money';
import {
  LinkWithViewTransition,
  useNavigateWithViewTransition,
} from '~/lib/transitions';
import { AccountSelector } from '../accounts/account-selector';
import { tokenToMoney } from '../shared/cashu';
import { getErrorMessage } from '../shared/error';
import { MoneyWithConvertedAmount } from '../shared/money-with-converted-amount';
import { useAuthActions } from '../user/auth';
import { useFailCashuReceiveQuote } from './cashu-receive-quote-hooks';
import { useCreateCashuTokenSwap } from './cashu-token-swap-hooks';
import {
  useCashuTokenSourceAccountQuery,
  useCashuTokenWithClaimableProofs,
  useCreateCrossAccountReceiveQuotes,
  useReceiveCashuTokenAccounts,
} from './receive-cashu-token-hooks';
import type { CashuAccountWithTokenFlags } from './receive-cashu-token-models';

type Props = {
  token: Token;
  /** The initially selected receive account will be set to this account if it exists.*/
  preferredReceiveAccountId?: string;
};

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
        copyToClipboard(getEncodedToken(claimableToken ?? token));
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
  const { claimableToken, cannotClaimReason } =
    useCashuTokenWithClaimableProofs({ token });
  const {
    selectableAccounts,
    receiveAccount,
    isCrossMintSwapDisabled,
    sourceAccount,
    setReceiveAccount,
    addAndSetReceiveAccount,
  } = useReceiveCashuTokenAccounts(token, preferredReceiveAccountId);

  const isReceiveAccountKnown = receiveAccount?.isUnknown === false;

  const onTransactionCreated = (transactionId: string) => {
    navigate(`/transactions/${transactionId}?redirectTo=/`, {
      transition: 'slideLeft',
      applyTo: 'newView',
    });
  };

  const { mutateAsync: createCashuTokenSwap } = useCreateCashuTokenSwap();
  const {
    mutateAsync: createCrossAccountReceiveQuotes,
    data: crossAccountReceiveQuotes,
  } = useCreateCrossAccountReceiveQuotes();
  const { mutate: failCashuReceiveQuote } = useFailCashuReceiveQuote();

  const { mutate: claimTokenMutation, status: claimTokenStatus } = useMutation({
    mutationFn: async ({
      token,
      sourceAccount,
      receiveAccount,
    }: {
      token: Token;
      sourceAccount: CashuAccountWithTokenFlags;
      receiveAccount: CashuAccountWithTokenFlags;
    }) => {
      const account = receiveAccount.isUnknown
        ? await addAndSetReceiveAccount(receiveAccount)
        : receiveAccount;

      const isSameAccountClaim =
        account.currency === sourceAccount.currency &&
        account.mintUrl === sourceAccount.mintUrl;

      if (isSameAccountClaim) {
        const {
          swap: { transactionId },
        } = await createCashuTokenSwap({
          token,
          accountId: account.id,
        });
        onTransactionCreated(transactionId);
      } else {
        const { sourceWallet, cashuMeltQuote, cashuReceiveQuote } =
          await createCrossAccountReceiveQuotes({
            token,
            destinationAccount: account,
            sourceAccount,
          });
        onTransactionCreated(cashuReceiveQuote.transactionId);
        await sourceWallet.meltProofs(cashuMeltQuote, token.proofs);
      }

      return account;
    },
    onError: (error) => {
      if (error instanceof MintOperationError && crossAccountReceiveQuotes) {
        failCashuReceiveQuote({
          quoteId: crossAccountReceiveQuotes.cashuReceiveQuote.id,
          reason: error.message,
        });
      }
      console.error('Error claiming token', { cause: error });
      toast({
        title: 'Failed to claim token',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    },
  });

  return (
    <>
      <PageHeader className="z-10">
        <PageBackButton
          to="/receive"
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
              <AccountSelector
                accounts={selectableAccounts}
                selectedAccount={receiveAccount}
                disabled={isCrossMintSwapDisabled}
                onSelect={setReceiveAccount}
              />
            </div>
          ) : (
            <TokenErrorDisplay
              message={
                !claimableToken
                  ? cannotClaimReason
                  : 'Token from this mint cannot be claimed'
              }
            />
          )}
        </div>
      </PageContent>

      {claimableToken && receiveAccount && (
        <PageFooter className="pb-14">
          <Button
            disabled={receiveAccount.isSelectable === false}
            onClick={() => {
              claimTokenMutation({
                token: claimableToken,
                sourceAccount,
                receiveAccount,
              });
            }}
            className="w-[200px]"
            // loading while the mutation is running or while waiting for navigation after mutation success
            loading={
              claimTokenStatus === 'pending' || claimTokenStatus === 'success'
            }
          >
            {isReceiveAccountKnown ? 'Claim' : 'Add Mint and Claim'}
          </Button>
        </PageFooter>
      )}
    </>
  );
}

const addAutoClaimSearchParam = (
  navigate: NavigateFunction,
  location: Location,
) => {
  const searchParams = new URLSearchParams(location.search);
  searchParams.set('autoClaim', true.toString());
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

export function PublicReceiveCashuToken({ token }: { token: Token }) {
  const [signingUpGuest, setSigningUpGuest] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { signUpGuest } = useAuthActions();
  const { toast } = useToast();
  const guestSignupEnabled = useFeatureFlag('GUEST_SIGNUP');
  const {
    data: { sourceAccount },
  } = useCashuTokenSourceAccountQuery(token);
  const { claimableToken, cannotClaimReason } =
    useCashuTokenWithClaimableProofs({
      token,
    });

  const encodedToken = getEncodedToken(claimableToken ?? token);

  const handleClaimAsGuest = async () => {
    if (!claimableToken) {
      return;
    }

    setSigningUpGuest(true);
    try {
      // Modify the URL before signing up because as soon as the user is logged in,
      // they will be redirected to the protected receive cashu token page
      addAutoClaimSearchParam(navigate, location);

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

  return (
    <>
      <PageHeader className="z-10">
        <ClosePageButton
          to="/signup"
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>Receive</PageHeaderTitle>
      </PageHeader>
      <PageContent className="flex flex-col items-center">
        <TokenAmountDisplay
          token={token}
          claimableToken={claimableToken}
          receiveAccountCurrency={sourceAccount.currency}
        />

        <div className="absolute top-0 right-0 bottom-0 left-0 mx-auto flex max-w-sm items-center justify-center">
          {claimableToken ? (
            <div className="w-full max-w-sm px-4">
              <AccountSelector
                accounts={[]}
                selectedAccount={sourceAccount}
                disabled={true}
              />
            </div>
          ) : (
            <TokenErrorDisplay message={cannotClaimReason} />
          )}
        </div>
      </PageContent>

      {claimableToken && (
        <PageFooter className="pb-14">
          <div className="flex flex-col gap-4">
            {guestSignupEnabled && (
              <Button
                onClick={handleClaimAsGuest}
                className="w-[200px]"
                loading={signingUpGuest}
              >
                Claim as Guest
              </Button>
            )}

            <LinkWithViewTransition
              to={{
                pathname: '/login',
                search: 'redirectTo=/receive/cashu/token',
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
