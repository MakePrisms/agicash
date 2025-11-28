import type {
  ExtendedCashuAccount,
  ExtendedSparkAccount,
} from '../accounts/account';

type TokenFlags = {
  /** Whether the account is the source account of the token */
  isSource: boolean;
  /** Whether the account is unknown to the user */
  isUnknown: boolean;
  /** Whether the account is selectable can receive the token */
  canReceive: boolean;
};

export type CashuAccountWithTokenFlags = ExtendedCashuAccount & TokenFlags;
export type SparkAccountWithTokenFlags = ExtendedSparkAccount & TokenFlags;

/**
 * Union type representing all possible account types that can be selected for receiving tokens.
 */
export type AccountWithTokenFlags =
  | CashuAccountWithTokenFlags
  | SparkAccountWithTokenFlags;
