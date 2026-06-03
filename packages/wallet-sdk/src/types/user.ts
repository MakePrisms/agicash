/**
 * User domain types — §4 of the contract.
 *
 * Lifted verbatim from `app/features/user/user.ts`:
 * `User = CommonUserData ∧ (FullUser | GuestUser)`.
 */
import type { Currency } from './money';

type CommonUserData = {
  id: string;
  username: string;
  emailVerified: boolean;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
  defaultBtcAccountId: string;
  defaultUsdAccountId: string | null;
  defaultCurrency: Currency;
  cashuLockingXpub: string;
  encryptionPublicKey: string;
  sparkIdentityPublicKey: string;
  termsAcceptedAt: string | null;
  giftCardMintTermsAcceptedAt: string | null;
};

export type FullUser = CommonUserData & {
  email: string;
  isGuest: false;
};

export type GuestUser = CommonUserData & {
  isGuest: true;
};

export type User = FullUser | GuestUser;
