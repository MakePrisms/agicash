import type { NetworkType } from '@buildonspark/spark-sdk';
import type { QueryClient } from '@tanstack/react-query';
import type { DistributedOmit } from 'type-fest';
import type { z } from 'zod';
import type { Currency } from '~/lib/money';
import type { Account, RedactedAccount } from '../accounts/account';
import {
  type AccountRepository,
  useAccountRepository,
} from '../accounts/account-repository';
import {
  type AgicashDb,
  type AgicashDbAccount,
  type AgicashDbUser,
  isCashuAccount,
  isSparkAccount,
} from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import { CashuAccountDetailsDbDataSchema } from '../agicash-db/json-models/cashu-account-details-db-data';
import { SparkAccountDetailsDbDataSchema } from '../agicash-db/json-models/spark-account-details-db-data';
import { getInitializedCashuWallet } from '../shared/cashu';
import { UniqueConstraintError } from '../shared/error';
import { getInitializedSparkWallet } from '../shared/spark';
import type { User } from './user';

export type UpdateUser = {
  defaultBtcAccountId?: string;
  defaultUsdAccountId?: string | null;
  defaultCurrency?: Currency;
  username?: string;
};

type Options = {
  abortSignal?: AbortSignal;
};

type AccountInput = {
  isDefault?: boolean;
} & DistributedOmit<
  Account,
  | 'id'
  | 'createdAt'
  | 'version'
  | 'proofs'
  | 'keysetCounters'
  | 'wallet'
  | 'isOnline'
  | 'balance'
>;

/**
 * Maps a database user row to a user object.
 * @param dbUser - The database user row.
 * @returns The user object.
 */
function toUser(dbUser: AgicashDbUser): User {
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
      sparkIdentityPublicKey: dbUser.spark_identity_public_key,
      defaultBtcAccountId: dbUser.default_btc_account_id ?? '',
      defaultUsdAccountId: dbUser.default_usd_account_id ?? null,
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
    defaultUsdAccountId: dbUser.default_usd_account_id ?? null,
    defaultCurrency: dbUser.default_currency,
    isGuest: true,
    cashuLockingXpub: dbUser.cashu_locking_xpub,
    encryptionPublicKey: dbUser.encryption_public_key,
    sparkIdentityPublicKey: dbUser.spark_identity_public_key,
  };
}

export class WriteUserRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly accountRepository: AccountRepository,
  ) {}

  /**
   * Updates a user in the database.
   * @param user - The user data to update. All specified properties will be updated.
   * @returns The updated user.
   * @throws Error if trying to set default_currency when no default account is set for the given currency (enforced by database constraint)
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

    return toUser(updatedUser);
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
      accounts: AccountInput[];
      /**
       * The extended public key used for locking proofs and mint quotes.
       */
      cashuLockingXpub: string;
      /**
       * The public key used for encryption.
       */
      encryptionPublicKey: string;
      /**
       * The user's Spark identity public key.
       */
      sparkIdentityPublicKey: string;
    },
    options?: Options,
  ): Promise<{ user: User; accounts: Account[] }> {
    const accountsToAdd = user.accounts.map((account) => ({
      name: account.name,
      type: account.type,
      currency: account.currency,
      is_default: account.isDefault ?? false,
      details: (() => {
        if (account.type === 'cashu') {
          return CashuAccountDetailsDbDataSchema.parse({
            mint_url: account.mintUrl,
            is_test_mint: account.isTestMint,
            keyset_counters: {},
          } satisfies z.input<typeof CashuAccountDetailsDbDataSchema>);
        }

        return SparkAccountDetailsDbDataSchema.parse({
          network: account.network,
        } satisfies z.input<typeof SparkAccountDetailsDbDataSchema>);
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
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to upsert user', { cause: error });
    }

    const { accounts, user: upsertedUser } = data;
    return {
      user: toUser(upsertedUser),
      accounts: await Promise.all(
        accounts.map((account) => this.accountRepository.toAccount(account)),
      ),
    };
  }
}

export class ReadUserDefaultAccountRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly queryClient: QueryClient,
    private readonly getSparkWalletMnemonic: () => Promise<string>,
  ) {}

  /**
   * Gets the user's default account. If currency is not provided, the default currency of the user is used.
   * @returns The user's default account.
   */
  async getDefaultAccount(userId: string, currency?: Currency) {
    const { data, error } = await this.db
      .from('users')
      .select(`
        *,
        accounts:accounts!user_id(
          *,
          cashu_proofs(*)
        )
      `)
      .eq('id', userId)
      .eq('accounts.cashu_proofs.state', 'UNSPENT')
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

    return await this.toAccount(account);
  }

  private async toAccount(data: AgicashDbAccount): Promise<RedactedAccount> {
    const commonData = {
      id: data.id,
      name: data.name,
      currency: data.currency,
      createdAt: data.created_at,
      version: data.version,
    };

    if (isCashuAccount(data)) {
      const details = data.details;

      const { wallet, isOnline } = await getInitializedCashuWallet(
        this.queryClient,
        details.mint_url,
        data.currency,
      );

      return {
        ...commonData,
        isOnline,
        type: 'cashu',
        mintUrl: details.mint_url,
        isTestMint: details.is_test_mint,
        keysetCounters: details.keyset_counters,
        wallet,
      };
    }

    if (isSparkAccount(data)) {
      const { network } = data.details;
      const { wallet, balance, isOnline } =
        await this.getInitializedSparkWallet(network);

      return {
        ...commonData,
        type: 'spark',
        balance,
        network,
        isOnline,
        wallet,
      };
    }

    throw new Error('Invalid account type');
  }

  private async getInitializedSparkWallet(network: NetworkType) {
    const mnemonic = await this.getSparkWalletMnemonic();
    return getInitializedSparkWallet(this.queryClient, mnemonic, network);
  }
}

export class ReadUserRepository {
  constructor(private readonly db: AgicashDb) {}

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

    return toUser(data);
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

    return data ? toUser(data) : null;
  }
}

export function useReadUserRepository() {
  return new ReadUserRepository(agicashDbClient);
}

export function useWriteUserRepository() {
  const accountRepository = useAccountRepository();
  return new WriteUserRepository(agicashDbClient, accountRepository);
}
