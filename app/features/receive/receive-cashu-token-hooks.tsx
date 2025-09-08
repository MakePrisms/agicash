import type { Token } from '@cashu/cashu-ts';
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useState } from 'react';
import type {
  Account,
  CashuAccount,
  ExtendedCashuAccount,
} from '~/features/accounts/account';
import {
  useAccounts,
  useAddCashuAccount,
  useDefaultAccount,
} from '~/features/accounts/account-hooks';
import {
  allMintKeysetsQuery,
  cashuMintValidator,
  isTestMintQuery,
  mintInfoQuery,
  tokenToMoney,
} from '~/features/shared/cashu';
import { useGetExchangeRate } from '~/hooks/use-exchange-rate';
import {
  areMintUrlsEqual,
  getCashuProtocolUnit,
  getCashuUnit,
  getCashuWallet,
  getClaimableProofs,
  getUnspentProofsFromToken,
} from '~/lib/cashu';
import type { AccountWithBadges } from '../accounts/account-selector';
import { useUser } from '../user/user-hooks';
import { useReceiveCashuTokenService } from './receive-cashu-token-service';

type CashuAccountWithBadges = AccountWithBadges<CashuAccount>;

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
  existingAccount?: ExtendedCashuAccount,
) {
  const tokenCurrency = tokenToMoney(token).currency;
  const queryClient = useQueryClient();

  return useSuspenseQuery({
    queryKey: [
      'token-source-account',
      token.mint,
      tokenCurrency,
      existingAccount?.id,
    ],
    queryFn: async (): Promise<{
      isValid: boolean;
      sourceAccount: ExtendedCashuAccount;
    }> => {
      if (existingAccount) {
        return {
          isValid: true,
          sourceAccount: existingAccount,
        };
      }

      const [info, keysets, isTestMint] = await Promise.all([
        queryClient.fetchQuery(mintInfoQuery(token.mint)),
        queryClient.fetchQuery(allMintKeysetsQuery(token.mint)),
        queryClient.fetchQuery(isTestMintQuery(token.mint)),
      ]);

      const validationResult = cashuMintValidator(
        token.mint,
        getCashuProtocolUnit(tokenCurrency),
        info,
        keysets.keysets,
      );

      return {
        isValid: validationResult === true,
        sourceAccount: {
          id: '',
          type: 'cashu',
          mintUrl: token.mint,
          createdAt: new Date().toISOString(),
          name: info?.name ?? token.mint.replace('https://', ''),
          currency: tokenToMoney(token).currency,
          isTestMint,
          version: 0,
          keysetCounters: {},
          proofs: [],
          isDefault: false,
          wallet: getCashuWallet(token.mint, {
            unit: getCashuUnit(tokenCurrency),
            mintInfo: info,
          }),
        },
      };
    },
    staleTime: 3 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Takes a token and returns the account that the token is from.
 * If the account does not exist, we construct and return an account, but we do not store it in the database.
 */
function useCashuTokenSourceAccount(token: Token) {
  const tokenCurrency = tokenToMoney(token).currency;
  const { data: allAccounts } = useAccounts({ type: 'cashu' });
  const existingAccount = allAccounts.find(
    (a) =>
      areMintUrlsEqual(a.mintUrl, token.mint) && a.currency === tokenCurrency,
  );

  const { data } = useCashuTokenSourceAccountQuery(token, existingAccount);

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

const getDefaultReceiveAccount = (
  selectableAccounts: CashuAccountWithBadges[],
  sourceAccount: CashuAccount,
  isCrossMintSwapDisabled: boolean,
  defaultAccount: Account,
): CashuAccount => {
  const targetAccount =
    isCrossMintSwapDisabled || defaultAccount.type !== 'cashu'
      ? sourceAccount
      : defaultAccount;

  const matchingAccount = selectableAccounts.find(
    (a) => a.id === targetAccount.id && a.selectable,
  );

  // If no matching selectable account found, get the first selectable account
  if (!matchingAccount) {
    const firstSelectable = selectableAccounts.find((a) => a.selectable);
    if (firstSelectable) {
      return firstSelectable;
    }
  }

  // Fall back to source account if no match found
  return matchingAccount ?? sourceAccount;
};

const getBadges = (
  account: CashuAccount,
  allAccounts: CashuAccount[],
  sourceAccount: CashuAccount,
  defaultAccount: Account,
  isSourceAccountValid: boolean,
) => {
  const badges: string[] = [];

  if (sourceAccount.isTestMint) {
    badges.push('Test Mint');
  }
  if (account.id === sourceAccount.id) {
    badges.push('Source');
    if (!isSourceAccountValid) {
      badges.push('Invalid');
    }
  }
  if (account.id === defaultAccount.id) {
    badges.push('Default');
  }
  if (!allAccounts.some((a) => areMintUrlsEqual(a.mintUrl, account.mintUrl))) {
    badges.push('Unknown');
  }

  return badges;
};

const getSelectableAccounts = (
  sourceAccount: CashuAccount,
  isSourceAccountValid: boolean,
  isCrossMintSwapDisabled: boolean,
  accounts: CashuAccount[],
  defaultAccount: Account,
): CashuAccountWithBadges[] => {
  const baseAccounts = isCrossMintSwapDisabled
    ? [sourceAccount]
    : [
        sourceAccount,
        ...accounts.filter(
          (account) => !account.isTestMint && account.id !== sourceAccount.id,
        ),
      ];

  return baseAccounts.map((account) => ({
    ...account,
    badges: getBadges(
      account,
      accounts,
      sourceAccount,
      defaultAccount,
      isSourceAccountValid,
    ),
    selectable: account.id === sourceAccount.id ? isSourceAccountValid : true,
  }));
};

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
  const { sourceAccount, isValid: isSourceAccountValid } =
    useCashuTokenSourceAccount(token);
  const { data: accounts } = useAccounts({ type: 'cashu' });
  const addCashuAccount = useAddCashuAccount();
  const defaultAccount = useDefaultAccount();

  const isCrossMintSwapDisabled = sourceAccount.isTestMint;
  const selectableAccounts = getSelectableAccounts(
    sourceAccount,
    isSourceAccountValid,
    isCrossMintSwapDisabled,
    accounts,
    defaultAccount,
  );
  const preferredReceiveAccount = selectableAccounts.find(
    (account) => account.id === preferredReceiveAccountId,
  );
  const defaultReceiveAccount = getDefaultReceiveAccount(
    selectableAccounts,
    sourceAccount,
    isCrossMintSwapDisabled,
    preferredReceiveAccount?.selectable
      ? preferredReceiveAccount
      : defaultAccount,
  );

  const [receiveAccountId, setReceiveAccountId] = useState<string>(
    defaultReceiveAccount.id,
  );
  const receiveAccount: CashuAccountWithBadges =
    selectableAccounts.find((account) => account.id === receiveAccountId) ??
    defaultReceiveAccount;

  const setReceiveAccount = (account: CashuAccountWithBadges) => {
    const selectableAccount = selectableAccounts.find(
      (a) => a.id === account.id,
    );
    if (!selectableAccount || !selectableAccount.selectable) {
      throw new Error('Account is not selectable');
    }

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
    selectableAccounts,
    receiveAccount,
    isCrossMintSwapDisabled,
    sourceAccount: selectableAccounts[0],
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
