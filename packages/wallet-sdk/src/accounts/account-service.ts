import {
  checkIsTestMint,
  findFirstActiveKeyset,
  getKeysetExpiry,
} from '@agicash/cashu';
import type { QueryClient } from '@tanstack/query-core';
import type { DistributedOmit } from 'type-fest';
import { allMintKeysetsQueryOptions } from '../cashu';
import type { Account, CashuAccount, ExtendedAccount } from './account';
import type { AccountRepository } from './account-repository';

/**
 * The slice of the user the service needs for default-account checks. The
 * web's User satisfies it structurally; replaced by the SDK User type when the
 * user domain is extracted.
 */
type UserDefaultAccounts = {
  defaultBtcAccountId: string | null;
  defaultUsdAccountId: string | null;
};

export type AccountServiceDeps = {
  accountRepository: AccountRepository;
  queryClient: QueryClient;
};

export class AccountService {
  private readonly accountRepository: AccountRepository;
  private readonly queryClient: QueryClient;

  constructor(deps: AccountServiceDeps) {
    this.accountRepository = deps.accountRepository;
    this.queryClient = deps.queryClient;
  }

  /**
   * Returns true if the account is the user's default account for the respective currency.
   */
  static isDefaultAccount(user: UserDefaultAccounts, account: Account) {
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
    user: UserDefaultAccounts,
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
      | 'expiresAt'
      | 'isTestMint'
      | 'keysetCounters'
      | 'proofs'
      | 'version'
      | 'wallet'
      | 'isOnline'
      | 'state'
    >;
  }) {
    const isTestMint = checkIsTestMint(account.mintUrl);

    let expiresAt: string | null = null;
    if (account.purpose === 'offer') {
      const { keysets } = await this.queryClient.fetchQuery(
        allMintKeysetsQueryOptions(account.mintUrl),
      );
      const activeKeyset = findFirstActiveKeyset(keysets, account.currency);
      if (activeKeyset) {
        expiresAt = getKeysetExpiry(activeKeyset)?.toISOString() ?? null;
      }
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
