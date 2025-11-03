import type { NetworkType as SparkNetwork } from '@buildonspark/spark-sdk';
import {
  type MintActiveKeys,
  type MintAllKeysets,
  NetworkError,
  type Proof,
} from '@cashu/cashu-ts';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import type { DistributedOmit } from 'type-fest';
import {
  type MintInfo,
  getCashuProtocolUnit,
  getCashuUnit,
  getCashuWallet,
} from '~/lib/cashu';
import { type Currency, Money } from '~/lib/money';
import {
  type AgicashDb,
  type AgicashDbAccount,
  agicashDb,
} from '../agicash-db/database';
import {
  allMintKeysetsQueryKey,
  allMintKeysetsQueryOptions,
  mintInfoQueryKey,
  mintInfoQueryOptions,
  mintKeysQueryKey,
  mintKeysQueryOptions,
  useCashuCryptography,
} from '../shared/cashu';
import { getDefaultUnit } from '../shared/currencies';
import { useEncryption } from '../shared/encryption';
import { getSparkWalletFromCache } from '../shared/spark';
import { useSparkCryptography } from '../shared/spark';
import type { Account, CashuAccount } from './account';

type AccountOmit<
  T extends Account,
  AdditionalOmit extends keyof T = never,
> = DistributedOmit<
  T,
  'id' | 'createdAt' | 'version' | 'isOnline' | AdditionalOmit
>;

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
    private readonly getSparkSeed?: () => Promise<Uint8Array | string>,
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
    let details = {};
    if (accountInput.type === 'cashu') {
      details = {
        mint_url: accountInput.mintUrl,
        is_test_mint: accountInput.isTestMint,
        keyset_counters: accountInput.keysetCounters,
        proofs: await this.encryption.encrypt(accountInput.proofs),
      };
    } else if (accountInput.type === 'nwc') {
      details = { nwc_url: accountInput.nwcUrl };
    } else if (accountInput.type === 'spark') {
      details = { network: accountInput.network };
    }
    const accountsToCreate = {
      name: accountInput.name,
      type: accountInput.type,
      currency: accountInput.currency,
      details,
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

      const { wallet, isOnline } = await this.getPreloadedWallet(
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

    if (data.type === 'spark') {
      const network = (data.details as { network: SparkNetwork }).network;

      const sparkWallet = getSparkWalletFromCache(this.queryClient, network);
      if (!sparkWallet) {
        throw new Error(`Spark wallet not initialized for network ${network}`);
      }

      const { balance: balanceSats } = await sparkWallet.getBalance();
      const balance = new Money({
        amount: balanceSats.toString(),
        currency: commonData.currency,
        unit: getDefaultUnit(commonData.currency),
      });

      return {
        ...commonData,
        type: 'spark',
        network: network,
        balance,
        isOnline: true,
      } as T;
    }

    throw new Error('Invalid account type');
  }

  private async getPreloadedWallet(mintUrl: string, currency: Currency) {
    const seed = await this.getCashuWalletSeed?.();

    let mintInfo: MintInfo;
    let allMintKeysets: MintAllKeysets;
    let mintActiveKeys: MintActiveKeys;

    try {
      [mintInfo, allMintKeysets, mintActiveKeys] = await Promise.race([
        Promise.all([
          this.queryClient.fetchQuery(mintInfoQueryOptions(mintUrl)),
          this.queryClient.fetchQuery(allMintKeysetsQueryOptions(mintUrl)),
          this.queryClient.fetchQuery(mintKeysQueryOptions(mintUrl)),
        ]),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            this.queryClient.cancelQueries({
              queryKey: mintInfoQueryKey(mintUrl),
            });
            this.queryClient.cancelQueries({
              queryKey: allMintKeysetsQueryKey(mintUrl),
            });
            this.queryClient.cancelQueries({
              queryKey: mintKeysQueryKey(mintUrl),
            });
            reject(new NetworkError('Mint request timed out'));
          }, 10_000);
        }),
      ]);
    } catch (error) {
      if (error instanceof NetworkError) {
        const wallet = getCashuWallet(mintUrl, {
          unit: getCashuUnit(currency),
          bip39seed: seed ?? undefined,
        });
        return { wallet, isOnline: false };
      }
      throw error;
    }

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

    return { wallet, isOnline: true };
  }
}

export function useAccountRepository() {
  const encryption = useEncryption();
  const queryClient = useQueryClient();
  const { getSeed: getCashuWalletSeed } = useCashuCryptography();
  const { getSeed: getSparkSeed } = useSparkCryptography();
  return new AccountRepository(
    agicashDb,
    {
      encrypt: encryption.encrypt,
      decrypt: encryption.decrypt,
    },
    queryClient,
    getCashuWalletSeed,
    getSparkSeed,
  );
}
