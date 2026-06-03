/**
 * User domain types — §4 of the contract.
 *
 * Lifted verbatim from `app/features/user/user.ts`:
 * `User = CommonUserData ∧ (FullUser | GuestUser)`.
 */
import type { Currency } from './money';

/** Fields shared by every user, whether full (email) or guest. */
type CommonUserData = {
  /** UUID of the user. */
  id: string;
  /** The user's unique handle within the app. */
  username: string;
  /** Whether the user has verified their email address. */
  emailVerified: boolean;
  /** Account creation time, ISO 8601. */
  createdAt: string;
  /** Last update time, ISO 8601. */
  updatedAt: string;
  /** UUID of the account used by default for BTC. */
  defaultBtcAccountId: string;
  /** UUID of the account used by default for USD, or null if none. */
  defaultUsdAccountId: string | null;
  /** The user's preferred display currency. */
  defaultCurrency: Currency;
  /** Extended public key used to derive cashu quote-locking keys. */
  cashuLockingXpub: string;
  /** Public key used to encrypt the user's data at rest. */
  encryptionPublicKey: string;
  /** The user's Spark identity public key. */
  sparkIdentityPublicKey: string;
  /** When the user accepted the terms of service (null if not yet accepted). */
  termsAcceptedAt: string | null;
  /** When the user accepted the gift-card mint terms (null if not yet accepted). */
  giftCardMintTermsAcceptedAt: string | null;
};

/** A signed-up user with a verified-or-pending email address. */
export type FullUser = CommonUserData & {
  /** The user's email address. */
  email: string;
  isGuest: false;
};

/** An anonymous guest user (no email); can be upgraded to a {@link FullUser}. */
export type GuestUser = CommonUserData & {
  isGuest: true;
};

/**
 * The current user — either a {@link FullUser} or a {@link GuestUser}. Lifted
 * verbatim from `app/features/user/user.ts`.
 */
export type User = FullUser | GuestUser;
