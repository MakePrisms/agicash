export {
  type UpdateUser,
  toUser,
  WriteUserRepository,
  ReadUserRepository,
} from '@agicash/sdk/features/user/user-repository';

import type { NetworkType } from '@buildonspark/spark-sdk';
import type { QueryClient } from '@tanstack/react-query';
import type { Currency } from '~/lib/money';
import type { RedactedAccount } from '../accounts/account';
import {
  type AccountRepository,
  useAccountRepository,
} from '../accounts/account-repository';
import {
  type AgicashDb,
  type AgicashDbAccount,
  isCashuAccount,
  isSparkAccount,
} from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import { getInitializedCashuWallet } from '../shared/cashu';
import { getInitializedSparkWallet } from '../shared/spark';
import {
  WriteUserRepository,
  ReadUserRepository,
} from '@agicash/sdk/features/user/user-repository';

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
      purpose: data.purpose,
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
      const { wallet, ownedBalance, availableBalance, isOnline } =
        await this.getInitializedSparkWallet(network);

      return {
        ...commonData,
        type: 'spark',
        ownedBalance,
        availableBalance,
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

export function useReadUserRepository() {
  return new ReadUserRepository(agicashDbClient);
}

export function useWriteUserRepository() {
  const accountRepository = useAccountRepository();
  return new WriteUserRepository(agicashDbClient, accountRepository);
}
