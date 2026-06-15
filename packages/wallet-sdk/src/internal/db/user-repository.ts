import { normalizeMintUrl } from '@agicash/cashu';
import type { Currency } from '@agicash/money';
import { UniqueConstraintError } from '../../errors';
import type { User } from '../../domains/user-types';
import type { AgicashDb, AgicashDbUser } from './database';
import { CashuAccountDetailsDbDataSchema } from './json-models/cashu-account-details-db-data';
import { SparkAccountDetailsDbDataSchema } from './json-models/spark-account-details-db-data';
import type { DefaultAccountInput } from './default-accounts';

export type UpdateUser = {
  defaultBtcAccountId?: string;
  defaultUsdAccountId?: string | null;
  defaultCurrency?: Currency;
  username?: string;
  termsAcceptedAt?: string;
  giftCardMintTermsAcceptedAt?: string;
};

type UpsertUserInput = {
  id: string;
  email?: string | null;
  emailVerified: boolean;
  accounts: readonly DefaultAccountInput[];
  cashuLockingXpub: string;
  encryptionPublicKey: string;
  sparkIdentityPublicKey: string;
  termsAcceptedAt?: string;
  giftCardMintTermsAcceptedAt?: string;
};

export class ReadUserRepository {
  constructor(private readonly db: AgicashDb) {}

  async get(
    userId: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<User> {
    const query = this.db.from('users').select().eq('id', userId);
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data, error } = await query.single();
    if (error) throw new Error('Failed to get user', { cause: error });
    return ReadUserRepository.toUser(data);
  }

  async getByUsername(
    username: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<User | null> {
    const query = this.db.from('users').select().eq('username', username);
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data, error } = await query.maybeSingle();
    if (error)
      throw new Error('Failed to get user by username', { cause: error });
    return data ? ReadUserRepository.toUser(data) : null;
  }

  static toUser(dbUser: AgicashDbUser): User {
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
    if (dbUser.email)
      return { ...commonData, email: dbUser.email, isGuest: false };
    return { ...commonData, isGuest: true };
  }
}

export class WriteUserRepository {
  constructor(private readonly db: AgicashDb) {}

  /** Creates or reconciles the user (and seeds default account rows server-side
   * via the RPC). Returns only the mapped User — account-row mapping/wallet init
   * is a later plan. */
  async upsert(
    user: UpsertUserInput,
    options?: { abortSignal?: AbortSignal },
  ): Promise<User> {
    const accountsToAdd = user.accounts.map((account) => ({
      name: account.name,
      type: account.type,
      currency: account.currency,
      is_default: account.isDefault ?? false,
      purpose: account.purpose,
      details: (() => {
        if (account.type === 'cashu') {
          return CashuAccountDetailsDbDataSchema.parse({
            mint_url: normalizeMintUrl(account.mintUrl),
            is_test_mint: account.isTestMint,
            keyset_counters: {},
          });
        }
        return SparkAccountDetailsDbDataSchema.parse({
          network: account.network,
        });
      })(),
    }));

    const query = this.db.rpc('upsert_user_with_accounts', {
      p_user_id: user.id,
      p_email: user.email ?? null,
      p_email_verified: user.emailVerified,
      p_accounts: accountsToAdd,
      p_cashu_locking_xpub: user.cashuLockingXpub,
      p_encryption_public_key: user.encryptionPublicKey,
      p_spark_identity_public_key: user.sparkIdentityPublicKey,
      p_terms_accepted_at: user.termsAcceptedAt,
      p_gift_card_mint_terms_accepted_at: user.giftCardMintTermsAcceptedAt,
    });
    if (options?.abortSignal) query.abortSignal(options.abortSignal);

    const { data, error } = await query;
    if (error) throw new Error('Failed to upsert user', { cause: error });
    return ReadUserRepository.toUser(data.user);
  }

  async update(
    userId: string,
    data: UpdateUser,
    options?: { abortSignal?: AbortSignal },
  ): Promise<User> {
    const query = this.db
      .from('users')
      .update({
        default_btc_account_id: data.defaultBtcAccountId,
        default_usd_account_id: data.defaultUsdAccountId,
        default_currency: data.defaultCurrency,
        username: data.username,
        terms_accepted_at: data.termsAcceptedAt,
        gift_card_mint_terms_accepted_at: data.giftCardMintTermsAcceptedAt,
      })
      .eq('id', userId)
      .select();
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data: updated, error } = await query.single();
    if (error) {
      if (error.code === '23505')
        throw new UniqueConstraintError(error.message);
      throw new Error('Failed to update user', { cause: error });
    }
    return ReadUserRepository.toUser(updated);
  }
}
