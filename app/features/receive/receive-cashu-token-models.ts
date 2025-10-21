import type { ExtendedCashuAccount } from '../accounts/account';

export type CashuAccountWithTokenFlags = ExtendedCashuAccount & {
  /** Whether the account is the source account of the token */
  isSource: boolean;
  /** Whether the account is unknown to the user */
  isUnknown: boolean;
  /** Whether the account is selectable can receive the token */
  canReceive: boolean;
};
