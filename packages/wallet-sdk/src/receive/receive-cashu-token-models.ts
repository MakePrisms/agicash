import { areMintUrlsEqual } from '@agicash/cashu';
import {
  type Account,
  type ExtendedCashuAccount,
  type ExtendedSparkAccount,
  canSendToLightning,
} from '../accounts/account';

type TokenFlags = {
  /** Whether the account is the source account of the cashu token. */
  isSource: boolean;
  /** Whether the user already has the account. */
  isUnknown: boolean;
  /** Whether the account can receive the cashu token. */
  canReceive: boolean;
  /** Why the account cannot receive, if applicable. */
  cannotReceiveReason?: string;
};

export type CashuAccountWithTokenFlags = ExtendedCashuAccount & TokenFlags;

export type ReceiveCashuTokenAccount = (
  | ExtendedCashuAccount
  | ExtendedSparkAccount
) &
  TokenFlags;

export const isClaimingToSameCashuAccount = (
  a: Account,
  b: Account,
): boolean => {
  return (
    a.type === 'cashu' &&
    b.type === 'cashu' &&
    a.currency === b.currency &&
    areMintUrlsEqual(a.mintUrl, b.mintUrl)
  );
};

/**
 * Picks the account a received cashu token should be claimed into: the source
 * account directly when it can't send to Lightning; otherwise the preferred
 * account, then the user's default account for the token's currency, then the
 * source account — whichever can first receive. Returns null if none can.
 */
export const getDefaultReceiveAccount = (
  sourceAccount: CashuAccountWithTokenFlags,
  possibleDestinationAccounts: ReceiveCashuTokenAccount[],
  preferredReceiveAccountId?: string,
): ReceiveCashuTokenAccount | null => {
  if (!canSendToLightning(sourceAccount)) {
    return sourceAccount.canReceive ? sourceAccount : null;
  }

  const preferredReceiveAccount = possibleDestinationAccounts.find(
    (account) => account.id === preferredReceiveAccountId,
  );

  if (preferredReceiveAccount?.canReceive) {
    return preferredReceiveAccount;
  }

  const defaultAccount = possibleDestinationAccounts.find(
    (account) =>
      account.isDefault && account.currency === sourceAccount.currency,
  );

  if (defaultAccount?.canReceive) {
    return defaultAccount;
  }

  if (sourceAccount.canReceive) {
    return sourceAccount;
  }

  return null;
};
