/**
 * Internal DB ⇄ domain `User` mapping — Slice 1 (auth + user).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/user/user-repository.ts` (`ReadUserRepository.toUser`
 * + the `users`-table reads/writes). Master expresses the user as a DB row in the
 * `wallet.users` table keyed by the OpenSecret user id — the agicash domain `User`
 * is NOT the OpenSecret `UserResponse`; it is that DB row mapped to the domain shape.
 *
 * This module owns:
 *  - {@link AgicashDbUser} — the `wallet.users` row shape (master:
 *    `agicash-db/database.ts#AgicashDbUser`, itself `database.types.ts` generated). Lifted
 *    verbatim as a hand-written type so the SDK can type the otherwise-`any` Supabase
 *    reads without pulling the full generated `Database` types (those land in a later slice).
 *  - {@link dbUserToUser} — the row→domain mapper (verbatim logic from
 *    `ReadUserRepository.toUser`: email present ⇒ `FullUser`, else `GuestUser`;
 *    `default_btc_account_id` defaults to `''`).
 *
 * @module
 */
import type { Currency } from '../types/money';
import type { FullUser, GuestUser, User } from '../types/user';

/**
 * A row of the `wallet.users` table.
 *
 * Lifted verbatim from master `agicash-db/database.ts#AgicashDbUser`
 * (`Database['wallet']['Tables']['users']['Row']`, generated in
 * `supabase/database.types.ts`). Hand-written here so the SDK can narrow the (currently
 * untyped) Supabase client reads in this slice; replaced by the generated `Database`
 * types when those are lifted into the package.
 */
export type AgicashDbUser = {
  /** UUID primary key (matches the OpenSecret user id). */
  id: string;
  /** The user's unique handle. */
  username: string;
  /** The user's email, or null for a guest. */
  email: string | null;
  /** Whether the email has been verified. */
  email_verified: boolean;
  /** Row creation time, ISO 8601. */
  created_at: string;
  /** Row last-update time, ISO 8601. */
  updated_at: string;
  /** UUID of the default BTC account, or null if unset. */
  default_btc_account_id: string | null;
  /** UUID of the default USD account, or null if unset. */
  default_usd_account_id: string | null;
  /** The user's preferred display currency. */
  default_currency: Currency;
  /** Extended public key used to derive cashu quote-locking keys. */
  cashu_locking_xpub: string;
  /** Public key used to encrypt the user's data at rest. */
  encryption_public_key: string;
  /** The user's Spark identity public key. */
  spark_identity_public_key: string;
  /** When the user accepted the terms of service (null if not yet accepted). */
  terms_accepted_at: string | null;
  /** When the user accepted the gift-card mint terms (null if not yet accepted). */
  gift_card_mint_terms_accepted_at: string | null;
};

/**
 * Map a `wallet.users` DB row to the domain {@link User}.
 *
 * Verbatim logic from master `ReadUserRepository.toUser`: an `email` present ⇒ a
 * {@link FullUser} (`isGuest: false`), otherwise a {@link GuestUser} (`isGuest: true`);
 * `default_btc_account_id` falls back to `''` when null.
 *
 * @param dbUser - the DB row.
 * @returns the domain user.
 */
export function dbUserToUser(dbUser: AgicashDbUser): User {
  const commonData = {
    id: dbUser.id,
    username: dbUser.username,
    emailVerified: dbUser.email_verified,
    createdAt: dbUser.created_at,
    updatedAt: dbUser.updated_at,
    cashuLockingXpub: dbUser.cashu_locking_xpub,
    encryptionPublicKey: dbUser.encryption_public_key,
    sparkIdentityPublicKey: dbUser.spark_identity_public_key,
    defaultBtcAccountId: dbUser.default_btc_account_id ?? '',
    defaultUsdAccountId: dbUser.default_usd_account_id,
    defaultCurrency: dbUser.default_currency,
    termsAcceptedAt: dbUser.terms_accepted_at,
    giftCardMintTermsAcceptedAt: dbUser.gift_card_mint_terms_accepted_at,
  };

  if (dbUser.email) {
    return {
      ...commonData,
      email: dbUser.email,
      isGuest: false,
    } satisfies FullUser;
  }

  return { ...commonData, isGuest: true } satisfies GuestUser;
}
