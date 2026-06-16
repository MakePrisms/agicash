import type { SupabaseClient } from '@supabase/supabase-js';
import { SdkError } from '../../errors';
import type { Currency } from '../../types/money';
import type { User } from '../../types/user';
import { classify } from '../classify';
import type { Database } from '../db/database';
import { toUser } from '../db/user-mapper';

type AccountInput = Database['wallet']['CompositeTypes']['account_input'];

/** Partial profile update; only the provided fields are written. */
export type UpdateUser = {
  defaultBtcAccountId?: string;
  defaultUsdAccountId?: string | null;
  defaultCurrency?: Currency;
  username?: string;
  termsAcceptedAt?: string;
  giftCardMintTermsAcceptedAt?: string;
};

/** Full user-row bootstrap payload for `upsert_user_with_accounts`. */
export type UpsertUserParams = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  accounts: AccountInput[];
  cashuLockingXpub: string;
  encryptionPublicKey: string;
  sparkIdentityPublicKey: string;
  termsAcceptedAt?: string;
  giftCardMintTermsAcceptedAt?: string;
};

/** Data access for the `wallet.users` row. Stateless; wraps the RLS client. */
export class UserRepository {
  constructor(private readonly db: SupabaseClient<Database>) {}

  /** The user with this id, or null if the row does not exist. */
  async get(userId: string): Promise<User | null> {
    const { data, error } = await this.db
      .from('users')
      .select()
      .eq('id', userId)
      .maybeSingle();
    if (error) throw classify(error);
    return data ? toUser(data) : null;
  }

  /** The user with this username, or null if none. */
  async getByUsername(username: string): Promise<User | null> {
    const { data, error } = await this.db
      .from('users')
      .select()
      .eq('username', username)
      .maybeSingle();
    if (error) throw classify(error);
    return data ? toUser(data) : null;
  }

  /** Apply a partial profile update; throws `DomainError` on a taken username. */
  async update(userId: string, data: UpdateUser): Promise<User> {
    const payload: Database['wallet']['Tables']['users']['Update'] = {};
    if (data.defaultBtcAccountId !== undefined)
      payload.default_btc_account_id = data.defaultBtcAccountId;
    if (data.defaultUsdAccountId !== undefined)
      payload.default_usd_account_id = data.defaultUsdAccountId;
    if (data.defaultCurrency !== undefined)
      payload.default_currency = data.defaultCurrency;
    if (data.username !== undefined) payload.username = data.username;
    if (data.termsAcceptedAt !== undefined)
      payload.terms_accepted_at = data.termsAcceptedAt;
    if (data.giftCardMintTermsAcceptedAt !== undefined)
      payload.gift_card_mint_terms_accepted_at =
        data.giftCardMintTermsAcceptedAt;

    const { data: row, error } = await this.db
      .from('users')
      .update(payload)
      .eq('id', userId)
      .select()
      .single();
    if (error) throw classify(error);
    if (!row)
      throw new SdkError('User update returned no row', 'UPDATE_FAILED');
    return toUser(row);
  }

  /** Ensure-on-resolve bootstrap: derive-keys + default accounts → user row. */
  async upsert(params: UpsertUserParams): Promise<User> {
    const args: Database['wallet']['Functions']['upsert_user_with_accounts']['Args'] =
      {
        p_user_id: params.id,
        p_email: params.email,
        p_email_verified: params.emailVerified,
        p_accounts: params.accounts,
        p_cashu_locking_xpub: params.cashuLockingXpub,
        p_encryption_public_key: params.encryptionPublicKey,
        p_spark_identity_public_key: params.sparkIdentityPublicKey,
      };
    if (params.termsAcceptedAt != null)
      args.p_terms_accepted_at = params.termsAcceptedAt;
    if (params.giftCardMintTermsAcceptedAt != null)
      args.p_gift_card_mint_terms_accepted_at =
        params.giftCardMintTermsAcceptedAt;

    const { data, error } = await this.db.rpc(
      'upsert_user_with_accounts',
      args,
    );
    if (error) throw classify(error);
    if (!data?.user)
      throw new SdkError(
        'upsert_user_with_accounts returned no user',
        'UPSERT_FAILED',
      );
    return toUser(data.user);
  }
}
