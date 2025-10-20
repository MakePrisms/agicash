import type { Proof } from '@cashu/cashu-ts';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import type { DistributedOmit } from 'type-fest';
import {
  getCashuProtocolUnit,
  getCashuUnit,
  getCashuWallet,
} from '~/lib/cashu';
import type { Currency } from '~/lib/money';
import {
  type AgicashDb,
  type AgicashDbAccount,
  agicashDb,
} from '../agicash-db/database';
import {
  allMintKeysetsQueryOptions,
  mintInfoQueryOptions,
  mintKeysQueryOptions,
  useCashuCryptography,
} from '../shared/cashu';
import { useEncryption } from '../shared/encryption';
import type { Account, CashuAccount } from './account';

type AccountOmit<
  T extends Account,
  AdditionalOmit extends keyof T = never,
> = DistributedOmit<T, 'id' | 'createdAt' | 'version' | AdditionalOmit>;

type AccountInput<T extends Account> = {
  userId: string;
} & (T extends CashuAccount
  ? AccountOmit<CashuAccount, 'wallet'>
  : AccountOmit<T>);

type Options = {
  abortSignal?: AbortSignal;
};

type Encryption = {
  encrypt: <T = unknown>(data: T) => Promise<string>;
  decrypt: <T = unknown>(data: string) => Promise<T>;
};

export class AccountRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly encryption: Encryption,
    private readonly queryClient: QueryClient,
    private readonly getCashuWalletSeed?: () => Promise<Uint8Array>,
  ) {}

  /**
   * Gets the account with the given id.
   * @param id - The id of the account to get.
   * @returns The account.
   */
  async get(id: string, options?: Options): Promise<Account> {
    const query = this.db.from('accounts').select().eq('id', id);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.single();

    if (error) {
      throw new Error('Failed to get account', { cause: error });
    }

    return this.toAccount(data);
  }

  /**
   * Gets all the accounts for the given user.
   * @param userId - The id of the user to get the accounts for.
   * @returns The accounts.
   */
  async getAll(userId: string, options?: Options): Promise<Account[]> {
    const query = this.db.from('accounts').select().eq('user_id', userId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to get accounts', { cause: error });
    }

    return Promise.all(data.map((x) => this.toAccount(x)));
  }

  /**
   * Creates a single account.
   * @param accountInput - The account to create.
   * @returns The created account.
   */
  async create<T extends Account = Account>(
    accountInput: AccountInput<T>,
    options?: Options,
  ): Promise<T> {
    const accountsToCreate = {
      name: accountInput.name,
      type: accountInput.type,
      currency: accountInput.currency,
      details:
        accountInput.type === 'cashu'
          ? {
              mint_url: accountInput.mintUrl,
              is_test_mint: accountInput.isTestMint,
              keyset_counters: accountInput.keysetCounters,
              proofs: await this.encryption.encrypt(accountInput.proofs),
            }
          : { nwc_url: accountInput.nwcUrl },
      user_id: accountInput.userId,
    };

    const query = this.db.from('accounts').insert(accountsToCreate).select();

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const resp = await query.single();
    const { data, error, status } = resp;

    if (error) {
      const message =
        status === 409 && accountInput.type === 'cashu'
          ? 'Account for this mint and currency already exists'
          : 'Failed to create account';
      throw new Error(message, { cause: error });
    }

    return this.toAccount<T>(data);
  }

  async toAccount<T extends Account = Account>(
    data: AgicashDbAccount,
  ): Promise<T> {
    const commonData = {
      id: data.id,
      name: data.name,
      currency: data.currency as Currency,
      createdAt: data.created_at,
      version: data.version,
    };

    if (data.type === 'cashu') {
      const details = data.details as {
        mint_url: string;
        is_test_mint: boolean;
        keyset_counters: Record<string, number>;
        proofs: string;
      };

      const wallet = await this.getPreloadedWallet(
        details.mint_url,
        data.currency,
      );

      return {
        ...commonData,
        type: 'cashu',
        mintUrl: details.mint_url,
        isTestMint: details.is_test_mint,
        keysetCounters: details.keyset_counters,
        proofs: await this.encryption.decrypt<Proof[]>(details.proofs),
        wallet,
      } as T;
    }

    if (data.type === 'nwc') {
      const details = data.details as { nwc_url: string };
      return {
        ...commonData,
        type: 'nwc',
        nwcUrl: details.nwc_url,
      } as T;
    }

    throw new Error('Invalid account type');
  }

  private async getPreloadedWallet(mintUrl: string, currency: Currency) {
    const seed = await this.getCashuWalletSeed?.();

    try {
      const [mintInfo, allMintKeysets, mintActiveKeys] = await Promise.all([
        this.queryClient.fetchQuery(mintInfoQueryOptions(mintUrl)),
        this.queryClient.fetchQuery(allMintKeysetsQueryOptions(mintUrl)),
        this.queryClient.fetchQuery(mintKeysQueryOptions(mintUrl)),
      ]);

      const unitKeysets = allMintKeysets.keysets.filter(
        (ks) => ks.unit === getCashuProtocolUnit(currency),
      );
      const activeKeyset = unitKeysets.find((ks) => ks.active);

      if (!activeKeyset) {
        throw new Error(`No active keyset found for ${currency} on ${mintUrl}`);
      }

      const activeKeysForUnit = mintActiveKeys.keysets.find(
        (ks) => ks.id === activeKeyset.id,
      );

      if (!activeKeysForUnit) {
        throw new Error(
          `Got active keyset ${activeKeyset.id} from ${mintUrl} but could not find keys for it`,
        );
      }

      const wallet = getCashuWallet(mintUrl, {
        unit: getCashuUnit(currency),
        bip39seed: seed ?? undefined,
        mintInfo,
        keys: activeKeysForUnit,
        keysets: unitKeysets,
      });

      // The constructor does not set the keysetId, so we need to set it manually
      wallet.keysetId = activeKeyset.id;

      return wallet;
    } catch {
      // TODO: This is a quick fix to prevent the app from bricking when a mint is unreachable
      // We should disable the account completley in this case because if the mint is offline,
      // the account won't be usable.
      return getCashuWallet(mintUrl, {
        unit: getCashuUnit(currency),
        bip39seed: seed ?? undefined,
      });
    }
  }
}

export function useAccountRepository() {
  const encryption = useEncryption();
  const queryClient = useQueryClient();
  const { getSeed: getCashuWalletSeed } = useCashuCryptography();
  return new AccountRepository(
    agicashDb,
    {
      encrypt: encryption.encrypt,
      decrypt: encryption.decrypt,
    },
    queryClient,
    getCashuWalletSeed,
  );
}
