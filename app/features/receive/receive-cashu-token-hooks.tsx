import { NetworkError, type Proof, type Token } from '@cashu/cashu-ts';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  CashuAccount,
  ExtendedCashuAccount,
} from '~/features/accounts/account';
import {
  useAccounts,
  useAddCashuAccount,
} from '~/features/accounts/account-hooks';
import { tokenToMoney } from '~/features/shared/cashu';
import { useGetExchangeRate } from '~/hooks/use-exchange-rate';
import {
  getCashuUnit,
  getCashuWallet,
  getClaimableProofs,
  getUnspentProofsFromToken,
} from '~/lib/cashu';
import {
  type AccountSelectorOption,
  toAccountSelectorOption,
} from '../accounts/account-selector';
import { useUser } from '../user/user-hooks';
import type { CashuAccountWithTokenFlags } from './receive-cashu-token-models';
import { useReceiveCashuTokenQuoteService } from './receive-cashu-token-quote-service';
import {
  ReceiveCashuTokenService,
  useReceiveCashuTokenService,
} from './receive-cashu-token-service';

type UseGetClaimableTokenProps = {
  token: Token;
  cashuPubKey?: string;
};

type TokenQueryResult =
  | {
      /** The token with only claimable proofs. Will be null if the token cannot be claimed */
      claimableToken: Token;
      /** The reason why the token cannot be claimed. Will be null when the token is claimable. */
      cannotClaimReason: null;
    }
  | {
      claimableToken: null;
      cannotClaimReason: string;
    };

/**
 * Hook that uses a suspense query to get the token's source account.
 * If the token's source is found in the existing accounts, the existing account will be returned.
 * If the token's source is not found in the existing accounts, the mint data is fetched, the validity of the mint is validated and a placeholder account is returned.
 */
export function useCashuTokenSourceAccountQuery(
  token: Token,
  existingCashuAccounts: ExtendedCashuAccount[] = [],
) {
  const tokenCurrency = tokenToMoney(token).currency;
  const receiveCashuTokenService = useReceiveCashuTokenService();

  return useSuspenseQuery({
    queryKey: [
      'token-source-account',
      token.mint,
      tokenCurrency,
      existingCashuAccounts,
    ],
    queryFn: async () =>
      receiveCashuTokenService.getSourceAndDestinationAccounts(
        token,
        existingCashuAccounts,
      ),
    staleTime: 3 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Takes a token and returns the account that the token is from.
 * If the account does not exist, we construct and return an account, but we do not store it in the database.
 */
function useCashuTokenSourceAccount(token: Token) {
  const { data: existingCashuAccounts } = useAccounts({ type: 'cashu' });
  const { data } = useCashuTokenSourceAccountQuery(
    token,
    existingCashuAccounts,
  );

  return data;
}

/**
 * This hook is used to check which proofs in a token are already spent and which
 * proofs have spending conditions that this user can satisfy.
 * @param token - The token to receive
 * @param cashuPubKey - The public key that the the user can provide signatures for
 * @returns A token with only proofs that can be claimed. If the token cannot be claimed,
 * the hook will return a reason why and a null token.
 */
export function useCashuTokenWithClaimableProofs({
  token,
  cashuPubKey,
}: UseGetClaimableTokenProps) {
  const { data: tokenData } = useSuspenseQuery({
    queryKey: ['token-state', token],
    queryFn: async (): Promise<TokenQueryResult> => {
      let unspentProofs: Proof[];
      try {
        unspentProofs = await getUnspentProofsFromToken(token);
      } catch (error) {
        if (error instanceof NetworkError) {
          return {
            claimableToken: null,
            cannotClaimReason: 'The mint that issued this ecash is offline',
          };
        }
        return {
          claimableToken: null,
          cannotClaimReason: 'An error occurred while checking the token',
        };
      }

      if (unspentProofs.length === 0) {
        return {
          claimableToken: null,
          cannotClaimReason: 'This ecash has already been spent',
        };
      }

      const { claimableProofs, cannotClaimReason } = getClaimableProofs(
        unspentProofs,
        cashuPubKey ? [cashuPubKey] : [],
      );

      return claimableProofs
        ? {
            claimableToken: { ...token, proofs: claimableProofs },
            cannotClaimReason: null,
          }
        : { cannotClaimReason, claimableToken: null };
    },
    retry: 1,
  });

  return tokenData;
}

const getBadges = (account: CashuAccountWithTokenFlags): string[] => {
  const badges: string[] = [];
  if (account.isTestMint) {
    badges.push('Test Mint');
  }
  if (account.isUnknown) {
    badges.push('Unknown');
  }
  if (account.isSource) {
    badges.push('Source');
  }
  if (!account.isOnline) {
    badges.push('Offline');
  }
  if (!account.canReceive) {
    badges.push('Invalid');
  }
  if (account.isDefault) {
    badges.push('Default');
  }

  return badges;
};

const toOption = (
  account: CashuAccountWithTokenFlags,
): AccountSelectorOption<CashuAccountWithTokenFlags> =>
  toAccountSelectorOption(account, {
    badges: getBadges(account),
    isSelectable: account.isOnline && account.canReceive,
  });

/**
 * Lets the user select an account to receive the token and returns data about the
 * selectable accounts based on the source account and the user's accounts in the database.
 * @param token - The being received
 * @param preferredReceiveAccountId - The account to initially select. If not provided
 * or the account is not selectable in this context, the default account will be selected.
 * @returns The selectable accounts, the receive account, the source account, and a function to set the receive account.
 */
export function useReceiveCashuTokenAccounts(
  token: Token,
  preferredReceiveAccountId?: string,
) {
  const addCashuAccount = useAddCashuAccount();
  const { sourceAccount, possibleDestinationAccounts } =
    useCashuTokenSourceAccount(token);

  const defaultReceiveAccount =
    ReceiveCashuTokenService.getDefaultReceiveAccount(
      sourceAccount,
      possibleDestinationAccounts,
      preferredReceiveAccountId,
    );

  const [receiveAccountId, setReceiveAccountId] = useState<string | null>(
    defaultReceiveAccount?.id ?? null,
  );
  const receiveAccount =
    possibleDestinationAccounts.find(
      (account) => account.id === receiveAccountId,
    ) ?? null;

  const setReceiveAccount = (
    account: AccountSelectorOption<CashuAccountWithTokenFlags>,
  ) => {
    setReceiveAccountId(account.id);
  };

  const addAndSetReceiveAccount = async (
    accountToAdd: CashuAccount,
  ): Promise<CashuAccount> => {
    const newAccount = await addCashuAccount(accountToAdd);
    setReceiveAccountId(newAccount.id);
    return newAccount;
  };

  return {
    selectableAccounts: possibleDestinationAccounts.map(toOption),
    receiveAccount: receiveAccount ? toOption(receiveAccount) : null,
    isCrossMintSwapDisabled: sourceAccount.isTestMint,
    sourceAccount: sourceAccount,
    setReceiveAccount,
    addAndSetReceiveAccount,
  };
}

type CreateCrossAccountReceiveQuotesProps = {
  /** The token to claim */
  token: Token;
  /** The account to claim the token to */
  destinationAccount: CashuAccount;
  /**
   * The account to claim the token from.
   * This may be a placeholder account if the token is from a mint that we do not have an account for.
   */
  sourceAccount: CashuAccount;
};

/**
 * Hook for creating cross-account receive quotes for cashu tokens.
 * Creates the necessary quotes and wallet for claiming tokens to a different mint or currency account.
 * The actual melting of proofs should be done by the caller.
 */
export function useCreateCrossAccountReceiveQuotes() {
  const userId = useUser((user) => user.id);
  const getExchangeRate = useGetExchangeRate();
  const receiveCashuTokenQuoteService = useReceiveCashuTokenQuoteService();

  return useMutation({
    mutationFn: async ({
      token,
      destinationAccount,
      sourceAccount,
    }: CreateCrossAccountReceiveQuotesProps) => {
      const tokenCurrency = tokenToMoney(token).currency;
      const accountCurrency = destinationAccount.currency;
      const exchangeRate = await getExchangeRate(
        `${tokenCurrency}-${accountCurrency}`,
      );

      const { cashuReceiveQuote, cashuMeltQuote } =
        await receiveCashuTokenQuoteService.createCrossAccountReceiveQuotes({
          userId,
          token,
          sourceAccount,
          destinationAccount,
          exchangeRate,
        });

      const sourceWallet = getCashuWallet(token.mint, {
        unit: getCashuUnit(tokenCurrency),
      });

      return { cashuReceiveQuote, cashuMeltQuote, sourceWallet };
    },
  });
}
