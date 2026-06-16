import { type Currency } from '@agicash/money';
import type { RedactedAccount } from '../../domains/account-types';
import { getInitializedCashuWallet } from '../cashu/init-wallet';
import type { MintDataCache } from '../cashu/mint-cache';
import {
  type AgicashMintAuthProvider,
  getMintAuthProvider,
} from '../cashu/mint-auth-provider';
import type { SparkWalletManager } from '../spark/wallet-manager';
import {
  type AgicashDb,
  type AgicashDbAccount,
  isCashuAccount,
  isSparkAccount,
} from './database';

type Options = { abortSignal?: AbortSignal };

/**
 * Reads the user's default account WITHOUT decrypting proofs (returns
 * RedactedAccount). Server-safe: no Encryption dependency and the cashu wallet is
 * initialized without a seed, so it runs in service-role mode where the user's
 * keys are unavailable (used by LN-address routes in Plan 5). Mirrors the app's
 * ReadUserDefaultAccountRepository.
 */
export class DefaultAccountRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly mintCache: MintDataCache,
    private readonly mintAuth: AgicashMintAuthProvider,
    private readonly sparkWallets: SparkWalletManager,
  ) {}

  async getDefault(
    userId: string,
    currency?: Currency,
    options?: Options,
  ): Promise<RedactedAccount> {
    const query = this.db
      .from('users')
      .select('*, accounts:accounts!user_id(*, cashu_proofs(*))')
      .eq('id', userId)
      .eq('accounts.cashu_proofs.state', 'UNSPENT');
    if (options?.abortSignal) query.abortSignal(options.abortSignal);

    const { data, error } = await query.single();
    if (error) {
      throw new Error('Failed to get default account', { cause: error });
    }

    const accountCurrency = currency ?? data.default_currency;
    const defaultAccountId =
      accountCurrency === 'BTC'
        ? data.default_btc_account_id
        : data.default_usd_account_id;
    const account = data.accounts.find((a) => a.id === defaultAccountId);
    if (!account) throw new Error('No default account found for user');
    return this.toAccount(account);
  }

  private async toAccount(data: AgicashDbAccount): Promise<RedactedAccount> {
    const commonData = {
      id: data.id,
      name: data.name,
      currency: data.currency,
      purpose: data.purpose,
      state: data.state,
      createdAt: data.created_at,
      version: data.version,
      expiresAt: data.expires_at,
    };

    if (isCashuAccount(data)) {
      const details = data.details;
      const { wallet, isOnline } = await getInitializedCashuWallet({
        mintCache: this.mintCache,
        mintUrl: details.mint_url,
        currency: data.currency,
        // No bip39seed: server has no user keys, and the default-account lookup
        // only needs mint info, not proof derivation.
        authProvider: getMintAuthProvider(data.purpose, this.mintAuth),
      });
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
        await this.sparkWallets.getWallet(network);
      return { ...commonData, type: 'spark', balance, network, isOnline, wallet };
    }

    throw new Error('Invalid account type');
  }
}
