import { type Currency, Money } from '@agicash/money';
import type {
  ClaimableTokenResult,
  GetTokenAccountsResult,
  ReceiveCashuTokenAccount,
} from '@agicash/wallet-sdk';
import type { Token } from '@cashu/cashu-ts';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { canSendToLightning } from '~/features/accounts/account';
import { tokenToMoney } from '~/features/shared/cashu';
import { getSdk } from '~/lib/sdk';
import { createSparkWalletStub } from '~/lib/spark';
import {
  type AccountSelectorOption,
  toAccountSelectorOption,
} from '../accounts/account-selector';
import { useReceiveCashuTokenService } from './receive-cashu-token-service';

type UseGetClaimableTokenProps = {
  token: Token;
  cashuPubKey?: string;
};

/**
 * Checks which proofs in a token are already spent and which proofs have spending
 * conditions that this user can satisfy.
 * @param token - The token to receive
 * @param cashuPubKey - The public key that the the user can provide signatures for
 * @returns A token with only proofs that can be claimed. If the token cannot be claimed,
 * the hook will return a reason why and a null token.
 */
export function useCashuTokenWithClaimableProofs({
  token,
  cashuPubKey,
}: UseGetClaimableTokenProps): ClaimableTokenResult {
  const { data } = useSuspenseQuery({
    queryKey: ['token-state', token],
    queryFn: () =>
      getSdk().cashu.receive.getClaimableToken({ token, cashuPubKey }),
    retry: 1,
  });

  return data;
}

const getBadges = (account: ReceiveCashuTokenAccount): string[] => {
  const badges: string[] = [];

  if (account.type === 'cashu' && account.isTestMint) {
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
  account: ReceiveCashuTokenAccount,
): AccountSelectorOption<ReceiveCashuTokenAccount> =>
  toAccountSelectorOption(account, {
    badges: getBadges(account),
    isSelectable: account.isOnline && account.canReceive,
  });

/**
 * Hook that uses a suspense query to read the token's source account, the accounts
 * it can be received into, and the default selection. Reads the user's accounts
 * inside the SDK (requires an authenticated user).
 */
function useTokenAccountsQuery(
  token: Token,
  preferredReceiveAccountId?: string,
): GetTokenAccountsResult {
  const { data } = useSuspenseQuery({
    queryKey: [
      'token-accounts',
      token.mint,
      tokenToMoney(token).currency,
      preferredReceiveAccountId,
    ],
    queryFn: () =>
      getSdk().cashu.receive.getTokenAccounts({
        token,
        preferredReceiveAccountId,
      }),
    staleTime: 3 * 60 * 1000,
    retry: 1,
  });

  return data;
}

/**
 * Lets the user select an account to receive the token and returns data about the
 * selectable accounts based on the source account and the user's accounts in the database.
 * @param token - The token being received
 * @param preferredReceiveAccountId - The account to initially select. If not provided
 * or the account is not selectable in this context, the default account will be selected.
 * @returns The selectable accounts, the selected receive account, the source account, and
 * a setter for the receive account.
 */
export function useReceiveCashuTokenAccounts(
  token: Token,
  preferredReceiveAccountId?: string,
) {
  const { sourceAccount, possibleDestinationAccounts, defaultReceiveAccount } =
    useTokenAccountsQuery(token, preferredReceiveAccountId);

  const [receiveAccountId, setReceiveAccountId] = useState<string | null>(
    defaultReceiveAccount?.id ?? null,
  );
  const receiveAccount =
    possibleDestinationAccounts.find(
      (account) => account.id === receiveAccountId,
    ) ?? null;

  const setReceiveAccount = (
    account: AccountSelectorOption<ReceiveCashuTokenAccount>,
  ) => {
    setReceiveAccountId(account.id);
  };

  return {
    selectableAccounts: possibleDestinationAccounts.map(toOption),
    receiveAccount: receiveAccount ? toOption(receiveAccount) : null,
    sourceAccount,
    setReceiveAccount,
  };
}

function useBuildCashuAccountPlaceholder(mintUrl: string, currency: Currency) {
  const receiveCashuTokenService = useReceiveCashuTokenService();

  const { data } = useSuspenseQuery({
    queryKey: ['build-cashu-account-for-mint', mintUrl, currency],
    queryFn: async () =>
      receiveCashuTokenService.buildAccountForMint(mintUrl, currency),
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });

  return data;
}

function getSparkAccountPlaceholder(): ReceiveCashuTokenAccount & {
  type: 'spark';
} {
  return {
    id: 'spark-account-placeholder-id',
    name: 'Bitcoin',
    type: 'spark',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency: 'BTC',
    wallet: createSparkWalletStub(
      'Cannot call methods on Spark account placeholder',
    ),
    createdAt: new Date().toISOString(),
    version: 0,
    balance: Money.zero('BTC'),
    network: 'MAINNET',
    expiresAt: null,
    isSource: false,
    isUnknown: false,
    canReceive: true,
    isDefault: true,
  };
}

function usePlacholderAccounts(
  token: Token,
): [
  ReceiveCashuTokenAccount & { type: 'spark' },
  ReceiveCashuTokenAccount & { type: 'cashu' },
] {
  const [sparkAccountPlaceholder] = useState(getSparkAccountPlaceholder());
  const tokenCurrency = tokenToMoney(token).currency;
  const cashuAccountPlaceholder = useBuildCashuAccountPlaceholder(
    token.mint,
    tokenCurrency,
  );

  return [sparkAccountPlaceholder, cashuAccountPlaceholder];
}

/**
 * Returns the placeholder accounts that can receive the cashu token.
 * Use to present the receive options when user is not signed in and we can't know which accounts they have.
 * Spark account is set as the receive account by default, unless the source cannot send to Lightning (test
 * mints and gift cards can only be claimed to the same mint).
 */
export function useReceiveCashuTokenAccountPlaceholders(token: Token) {
  const allPlaceholderAccounts = usePlacholderAccounts(token);
  const [sparkAccount, tokenCashuAccount] = allPlaceholderAccounts;

  const sourceCanSendToLightning = canSendToLightning(tokenCashuAccount);
  const selectableAccounts = sourceCanSendToLightning
    ? allPlaceholderAccounts
    : [tokenCashuAccount];
  const defaultAccount = sourceCanSendToLightning
    ? sparkAccount
    : tokenCashuAccount;

  const [receiveAccount, setReceiveAccount] = useState(() =>
    toOption(defaultAccount),
  );

  return {
    sourceAccount: tokenCashuAccount,
    selectableAccounts: selectableAccounts.map(toOption),
    receiveAccount,
    setReceiveAccount,
  };
}
