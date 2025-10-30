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
import type { Currency } from '~/lib/money';
import {
  type AgicashDb,
  type AgicashDbAccount,
  type AgicashDbAccountWithProofs,
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
import { type Encryption, useEncryption } from '../shared/encryption';
import type { Account, CashuAccount, CashuProof } from './account';

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
  ? AccountOmit<CashuAccount, 'wallet' | 'proofs'>
  : AccountOmit<T>);

type Options = {
  abortSignal?: AbortSignal;
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
    // Currently we limit the number of proofs returned to 6000
    // We will need to handle that somehow later (e.g. require use to swap when the limit is reaching)
    const query = this.db
      .from('accounts')
      .select('*, cashu_proofs(*)')
      .eq('id', id)
      .eq('cashu_proofs.state', 'UNSPENT');

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
   * @returns The accounts with unspent proofs.
   */
  async getAll(userId: string, options?: Options): Promise<Account[]> {
    // Currently we limit the number of proofs returned to 6000
    // We will need to handle that somehow later (e.g. require use to swap when the limit is reaching)
    const query = this.db
      .from('accounts')
      .select('*, cashu_proofs(*)')
      .eq('user_id', userId)
      .eq('cashu_proofs.state', 'UNSPENT');

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
            }
          : { nwc_url: accountInput.nwcUrl },
      user_id: accountInput.userId,
    };

    const query = this.db
      .from('accounts')
      .insert(accountsToCreate)
      .select('*, cashu_proofs(*)')
      .eq('cashu_proofs.state', 'UNSPENT');

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
    data: AgicashDbAccountWithProofs,
  ): Promise<T> {
    const commonData = {
      id: data.id,
      name: data.name,
      currency: data.currency as Currency,
      createdAt: data.created_at,
      version: data.version,
    };

    if (this.isCashuAccount(data)) {
      const details = data.details;

      const [{ wallet, isOnline }, proofs] = await Promise.all([
        this.getPreloadedWallet(details.mint_url, data.currency),
        this.decryptCashuProofs(data),
      ]);

      return {
        ...commonData,
        isOnline,
        type: 'cashu',
        mintUrl: details.mint_url,
        isTestMint: details.is_test_mint,
        keysetCounters: details.keyset_counters,
        proofs,
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

  private isCashuAccount(data: AgicashDbAccount): data is AgicashDbAccount & {
    type: 'cashu';
    details: {
      mint_url: string;
      is_test_mint: boolean;
      keyset_counters: Record<string, number>;
    };
  } {
    return data.type === 'cashu';
  }

  private async decryptCashuProofs(
    data: AgicashDbAccountWithProofs,
  ): Promise<CashuProof[]> {
    if (!this.isCashuAccount(data)) {
      throw new Error('Account is not a cashu account');
    }

    const encryptedData = data.cashu_proofs.flatMap((x) => [
      x.amount,
      x.secret,
    ]);
    const decryptedData = await this.encryption.decryptBatch(encryptedData);

    return data.cashu_proofs.map((dbProof, index) => {
      const decryptedDataIndex = index * 2;
      const amount = decryptedData[decryptedDataIndex] as number;
      const secret = decryptedData[decryptedDataIndex + 1] as string;
      return {
        id: dbProof.id,
        accountId: dbProof.account_id,
        userId: dbProof.user_id,
        keysetId: dbProof.keyset_id,
        amount,
        secret,
        unblindedSignature: dbProof.unblinded_signature,
        publicKeyY: dbProof.public_key_y,
        dleq: dbProof.dleq as Proof['dleq'],
        witness: dbProof.witness as Proof['witness'],
        state: dbProof.state as CashuProof['state'],
        version: dbProof.version,
        createdAt: dbProof.created_at,
        reservedAt: dbProof.reserved_at,
      };
    });
  }
}

export function useAccountRepository() {
  const encryption = useEncryption();
  const queryClient = useQueryClient();
  const { getSeed: getCashuWalletSeed } = useCashuCryptography();
  return new AccountRepository(
    agicashDb,
    encryption,
    queryClient,
    getCashuWalletSeed,
  );
}
