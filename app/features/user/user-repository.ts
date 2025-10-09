import type { DistributedOmit } from 'type-fest';
import type { Currency } from '~/lib/money';
import type { Account } from '../accounts/account';
import {
  type AccountRepository,
  useAccountRepository,
} from '../accounts/account-repository';
import {
  type AgicashDb,
  type AgicashDbUser,
  agicashDb,
} from '../agicash-db/database';
import { useEncryption } from '../shared/encryption';
import { UniqueConstraintError } from '../shared/error';
import type { User } from './user';

export type UpdateUser = {
  defaultBtcAccountId?: string;
  defaultUsdAccountId?: string;
  defaultCurrency?: Currency;
  username?: string;
};

type Options = {
  abortSignal?: AbortSignal;
};

type Encryption = {
  encrypt: <T = unknown>(data: T) => Promise<string>;
  decrypt: <T = unknown>(data: string) => Promise<T>;
};

export class UserRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly encryption: Encryption,
    private readonly accountRepository: AccountRepository,
  ) {}

  /**
   * Gets a user from the database.
   * @param userId - The id of the user to get.
   * @returns The user.
   */
  async get(
    userId: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<User> {
    const query = this.db.from('users').select().eq('id', userId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.single();

    if (error) {
      throw new Error('Failed to get user', { cause: error });
    }

    return this.toUser(data);
  }

  /**
   * Updates a user in the database.
   * @param user - The user data to update. All specified properties will be updated.
   * @returns The updated user.
   */
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
      })
      .eq('id', userId)
      .select();
    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data: updatedUser, error } = await query.single();

    if (error) {
      if (error.code === '23505') {
        throw new UniqueConstraintError(error.message);
      }

      throw new Error('Failed to update user', { cause: error });
    }

    return this.toUser(updatedUser);
  }

  /**
   * Inserts a user into the database. If the user already exists, it updates the user.
   * @param user - The user to upsert.
   * @returns The upserted user.
   */
  async upsert(
    user: {
      /**
       * Id of the user to insert.
       */
      id: string;
      /**
       * Email of the user to insert or new email to update for existing user.
       */
      email?: string | null | undefined;
      /**
       * Email verfified flag for the user to insert or new value to update for existing user.
       */
      emailVerified: boolean;
      /**
       * Accounts to insert for the user.
       * Will be used only when the account is created. For existing users, the accounts will be ignored.
       */
      accounts: DistributedOmit<
        Account,
        | 'id'
        | 'createdAt'
        | 'version'
        | 'proofs'
        | 'keysetCounters'
        | 'wallet'
        | 'isOnline'
      >[];
      /**
       * The extended public key used for locking proofs and mint quotes.
       */
      cashuLockingXpub: string;
      /**
       * The public key used for encryption.
       */
      encryptionPublicKey: string;
    },
    options?: Options,
  ): Promise<{ user: User; accounts: Account[] }> {
    const accountsToAdd = await Promise.all(
      user.accounts.map(async (account) => ({
        name: account.name,
        type: account.type,
        currency: account.currency,
        details:
          account.type === 'cashu'
            ? {
                mint_url: account.mintUrl,
                is_test_mint: account.isTestMint,
                keyset_counters: {},
                proofs: await this.encryption.encrypt([]),
              }
            : { nwc_url: account.nwcUrl },
      })),
    );

    const query = this.db.rpc('upsert_user_with_accounts', {
      p_user_id: user.id,
      p_email: user.email ?? null,
      p_email_verified: user.emailVerified,
      p_accounts: accountsToAdd,
      p_cashu_locking_xpub: user.cashuLockingXpub,
      p_encryption_public_key: user.encryptionPublicKey,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to upsert user', { cause: error });
    }

    const { accounts, ...upsertedUser } = data;
    return {
      user: this.toUser(upsertedUser),
      accounts: await Promise.all(
        accounts.map((a) => this.accountRepository.toAccount(a)),
      ),
    };
  }

  async getByUsername(
    username: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<User | null> {
    const query = this.db.from('users').select().eq('username', username);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get user by username', { cause: error });
    }

    return data ? this.toUser(data) : null;
  }

  /**
   * Gets the user's default account. If currency is not provided, the default currency of the user is used.
   * @returns The user's default account.
   */
  async getDefaultAccount(userId: string, currency?: Currency) {
    const { data, error } = await this.db
      .from('users')
      .select(`
        *,
        accounts:accounts!user_id(*)
      `)
      .eq('id', userId)
      .single();

    if (error) {
      throw new Error('Failed to get user default account IDs', error);
    }

    const defaultBtcAccountId = data.default_btc_account_id;
    const defaultUsdAccountId = data.default_usd_account_id;

    const accountCurrency = currency ?? data.default_currency;

    const defaultAccountId =
      accountCurrency === 'BTC' ? defaultBtcAccountId : defaultUsdAccountId;

    const account = data.accounts.find(
      (account) => account.id === defaultAccountId,
    );

    if (!account) {
      throw new Error('No default account found for user');
    }

    return this.accountRepository.toAccount(account);
  }

  private toUser(dbUser: AgicashDbUser): User {
    if (dbUser.email) {
      return {
        id: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        emailVerified: dbUser.email_verified,
        createdAt: dbUser.created_at,
        updatedAt: dbUser.updated_at,
        cashuLockingXpub: dbUser.cashu_locking_xpub,
        encryptionPublicKey: dbUser.encryption_public_key,
        defaultBtcAccountId: dbUser.default_btc_account_id ?? '',
        defaultUsdAccountId: dbUser.default_usd_account_id ?? '',
        defaultCurrency: dbUser.default_currency,
        isGuest: false,
      };
    }

    return {
      id: dbUser.id,
      username: dbUser.username,
      emailVerified: dbUser.email_verified,
      createdAt: dbUser.created_at,
      updatedAt: dbUser.updated_at,
      defaultBtcAccountId: dbUser.default_btc_account_id ?? '',
      defaultUsdAccountId: dbUser.default_usd_account_id ?? '',
      defaultCurrency: dbUser.default_currency,
      isGuest: true,
      cashuLockingXpub: dbUser.cashu_locking_xpub,
      encryptionPublicKey: dbUser.encryption_public_key,
    };
  }
}

export function useUserRepository() {
  const encryption = useEncryption();
  const accountRepository = useAccountRepository();
  return new UserRepository(agicashDb, encryption, accountRepository);
}
