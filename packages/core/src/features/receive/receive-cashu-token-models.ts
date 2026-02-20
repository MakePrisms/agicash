import { areMintUrlsEqual } from '../../lib/cashu';
import type {
  Account,
  ExtendedCashuAccount,
  ExtendedSparkAccount,
} from '../accounts/account';

type TokenFlags = {
  /** Whether the account is the source account of the cashu token. */
  isSource: boolean;
  /** Whether the user already has the account. */
  isUnknown: boolean;
  /** Whether the account can receive the cashu token. */
  canReceive: boolean;
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
