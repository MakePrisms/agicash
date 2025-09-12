import type { Token } from '@cashu/cashu-ts';
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
  areMintUrlsEqual,
  getCashuUnit,
  getCashuWallet,
  getClaimableProofs,
  getUnspentProofsFromToken,
} from '~/lib/cashu';
import type { AccountWithBadges } from '../accounts/account-selector';
import { useCashuAccountService } from '../accounts/cashu-account-service';
import { useUser } from '../user/user-hooks';
import { useReceiveCashuTokenService } from './receive-cashu-token-service';

type CashuAccountWithBadges = AccountWithBadges<CashuAccountWithFlags>;
export type CashuAccountWithFlags = ExtendedCashuAccount & {
  /** Whether the account is the source account */
  isSource: boolean;
  /** Whether the account is unknown to the user */
  isUnknown: boolean;
  /** Whether the account is selectable */
  isSelectable: boolean;
};

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
 * Hook that uses a suspense query to fetch mint info and validates it against our required features.
 * If an existing account is provided, it will be used instead of fetching the mint info.
 */
export function useCashuTokenSourceAccountQuery(
  token: Token,
  existingCashuAccounts: ExtendedCashuAccount[] = [],
) {
  const tokenCurrency = tokenToMoney(token).currency;
  const accountService = useCashuAccountService();

  return useSuspenseQuery({
    queryKey: [
      'token-source-account',
      token.mint,
      tokenCurrency,
      existingCashuAccounts,
    ],
    queryFn: async (): Promise<{
      isValid: boolean;
      data: ExtendedCashuAccount;
    }> => accountService.getSourceAccount(token, existingCashuAccounts),
    staleTime: 3 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Takes a token and returns the account that the token is from.
 * If the account does not exist, we construct and return an account, but we do not store it in the database.
 */
function useCashuTokenSourceAccount(token: Token): CashuAccountWithFlags {
  const { data: existingCashuAccounts } = useAccounts({ type: 'cashu' });
  const {
    data: { data: sourceAccount, isValid },
  } = useCashuTokenSourceAccountQuery(token, existingCashuAccounts);

  return {
    ...sourceAccount,
    isSource: true,
    isUnknown: !existingCashuAccounts.some((acc) =>
      areMintUrlsEqual(acc.mintUrl, sourceAccount.mintUrl),
    ),
    isSelectable: isValid,
  };
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
      const unspentProofs = await getUnspentProofsFromToken(token);
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

export const getDefaultReceiveAccount = (
  sourceAccount: CashuAccountWithFlags,
  possibleDestinationAccounts: CashuAccountWithFlags[],
  preferredReceiveAccountId?: string,
): CashuAccountWithFlags => {
  if (sourceAccount.isTestMint) {
    if (!sourceAccount.isSelectable) {
      // TODO: see what happens when this happens.
      throw new Error('Source account is not selectable');
    }
    // Tokens sourced from test mint can only be claimed to the same mint
    return sourceAccount;
  }

  const preferredReceiveAccount = possibleDestinationAccounts.find(
    (account) => account.id === preferredReceiveAccountId,
  );

  if (preferredReceiveAccount?.isSelectable) {
    return preferredReceiveAccount;
  }

  const defaultAccount = possibleDestinationAccounts.find(
    (account) => account.isDefault,
  );

  if (defaultAccount?.isSelectable) {
    return defaultAccount;
  }

  if (!sourceAccount.isSelectable) {
    // TODO: see what happens when this happens.
    throw new Error('Source account is not selectable');
  }

  return sourceAccount;
};

export const getPossibleDestinationAccounts = (
  sourceAccount: CashuAccountWithFlags,
  otherAccounts: CashuAccountWithFlags[],
) => {
  if (sourceAccount.isTestMint) {
    // Tokens sourced from test mint can only be claimed to the same mint
    return sourceAccount.isSelectable ? [sourceAccount] : [];
  }
  return [sourceAccount, ...otherAccounts].filter(
    (account) => account.isSelectable,
  );
};

const getBadges = (account: CashuAccountWithFlags): string[] => {
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
  if (!account.isSelectable) {
    badges.push('Invalid');
  }
  if (account.isDefault) {
    badges.push('Default');
  }

  return badges;
};

const toAccountWithBadges = (
  account: CashuAccountWithFlags,
): CashuAccountWithBadges => ({
  ...account,
  badges: getBadges(account),
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
  const sourceAccount = useCashuTokenSourceAccount(token);
  const { data: accounts } = useAccounts({ type: 'cashu' });
  const otherAccounts: CashuAccountWithFlags[] = accounts
    .filter((account) => account.id !== sourceAccount.id)
    .map((account) => ({
      ...account,
      isSource: false,
      isUnknown: false,
      isSelectable: !account.isTestMint,
    }));

  const addCashuAccount = useAddCashuAccount();

  const possibleDestinationAccounts = getPossibleDestinationAccounts(
    sourceAccount,
    otherAccounts,
  );

  const defaultReceiveAccount = getDefaultReceiveAccount(
    sourceAccount,
    possibleDestinationAccounts,
    preferredReceiveAccountId,
  );

  const [receiveAccountId, setReceiveAccountId] = useState<string>(
    defaultReceiveAccount.id,
  );
  const receiveAccount =
    possibleDestinationAccounts.find(
      (account) => account.id === receiveAccountId,
    ) ?? defaultReceiveAccount;

  const setReceiveAccount = (account: CashuAccountWithBadges) => {
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
    selectableAccounts: possibleDestinationAccounts.map(toAccountWithBadges),
    receiveAccount: toAccountWithBadges(receiveAccount),
    isCrossMintSwapDisabled: sourceAccount.isTestMint,
    sourceAccount: toAccountWithBadges(sourceAccount),
    setReceiveAccount,
    addAndSetReceiveAccount,
  };
}

type CreateCrossAccountReceiveQuotesProps = {
  /** The token to claim */
  token: Token;
  /** The account to claim the token to */
  account: CashuAccount;
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
  const receiveCashuTokenService = useReceiveCashuTokenService();

  return useMutation({
    mutationFn: async ({
      token,
      account,
      sourceAccount,
    }: CreateCrossAccountReceiveQuotesProps) => {
      const tokenCurrency = tokenToMoney(token).currency;
      const accountCurrency = account.currency;
      const exchangeRate = await getExchangeRate(
        `${tokenCurrency}-${accountCurrency}`,
      );

      const { cashuReceiveQuote, cashuMeltQuote } =
        await receiveCashuTokenService.createCrossAccountReceiveQuotes({
          userId,
          token,
          sourceAccount,
          destinationAccount: account,
          exchangeRate,
        });

      const sourceWallet = getCashuWallet(token.mint, {
        unit: getCashuUnit(tokenCurrency),
      });

      return { cashuReceiveQuote, cashuMeltQuote, sourceWallet };
    },
  });
}
