import type { User } from '../../types/user';
import type { AgicashDbUser } from './database';

/**
 * Maps a `wallet.users` row to the domain {@link User}. Guest vs full is
 * determined purely by email presence; a null `default_btc_account_id` maps to
 * the empty string (matches master's `ReadUserRepository.toUser`).
 */
export function toUser(dbUser: AgicashDbUser): User {
  const common = {
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
    return { ...common, email: dbUser.email, isGuest: false };
  }
  return { ...common, isGuest: true };
}
