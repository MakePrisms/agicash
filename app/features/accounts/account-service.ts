import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import type { DistributedOmit } from 'type-fest';
import { getOfferExpiresAt } from '~/lib/cashu';
import {
  allMintKeysetsQueryOptions,
  isTestMintQueryOptions,
  mintInfoQueryOptions,
} from '../shared/cashu';
import type { User } from '../user/user';
import type { Account, CashuAccount, ExtendedAccount } from './account';
import {
  type AccountRepository,
  useAccountRepository,
} from './account-repository';

export class AccountService {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly queryClient: QueryClient,
  ) {}

  /**
   * Returns true if the account is the user's default account for the respective currency.
   */
  static isDefaultAccount(user: User, account: Account) {
    if (account.currency === 'BTC') {
      return user.defaultBtcAccountId === account.id;
    }
    if (account.currency === 'USD') {
      return user.defaultUsdAccountId === account.id;
    }
    return false;
  }

  /**
   * Returns the accounts with the isDefault flag set to true if the account is the user's
   * default account for the respective currency. Sorts the default account to the top.
   */
  static getExtendedAccounts(
    user: User,
    accounts: Account[],
  ): ExtendedAccount[] {
    return accounts
      .map((account) => ({
        ...account,
        isDefault: AccountService.isDefaultAccount(user, account),
      }))
      .sort((_, b) => (b.isDefault ? 1 : -1)); // Sort the default account to the top;
  }

  async addCashuAccount({
    userId,
    account,
  }: {
    userId: string;
    account: DistributedOmit<
      CashuAccount,
      | 'id'
      | 'createdAt'
      | 'isTestMint'
      | 'keysetCounters'
      | 'expiresAt'
      | 'proofs'
      | 'version'
      | 'wallet'
      | 'isOnline'
    >;
  }) {
    const mintInfo = await this.queryClient.fetchQuery(
      mintInfoQueryOptions(account.mintUrl),
    );

    const isTestMint = await this.queryClient.fetchQuery(
      isTestMintQueryOptions(account.mintUrl, mintInfo),
    );

    let expiresAt: string | null = null;
    if (account.purpose === 'offer') {
      const { keysets } = await this.queryClient.fetchQuery(
        allMintKeysetsQueryOptions(account.mintUrl),
      );
      expiresAt = getOfferExpiresAt(keysets, account.currency);
    }

    return this.accountRepository.create<CashuAccount>({
      ...account,
      userId,
      isTestMint,
      expiresAt,
      keysetCounters: {},
    });
  }
}

export function useAccountService() {
  const accountRepository = useAccountRepository();
  const queryClient = useQueryClient();
  return new AccountService(accountRepository, queryClient);
}
