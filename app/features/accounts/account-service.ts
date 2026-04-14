import type { QueryClient } from '@tanstack/react-query';
import type { DistributedOmit } from 'type-fest';
import { allMintKeysetsQueryOptions } from '~/features/shared/cashu';
import {
  checkIsTestMint,
  findFirstActiveKeyset,
  getKeysetExpiry,
} from '~/lib/cashu';
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

export function useAccountService(queryClient: QueryClient) {
  const accountRepository = useAccountRepository();
  return new AccountService(accountRepository, queryClient);
}
