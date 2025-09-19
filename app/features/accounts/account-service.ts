import type { DistributedOmit } from 'type-fest';
import { checkIsTestMint } from '~/lib/cashu';
import type { User } from '../user/user';
import type { Account, CashuAccount, ExtendedAccount } from './account';
import {
  type AccountRepository,
  useAccountRepository,
} from './account-repository';
export class AccountService {
  constructor(private readonly accountRepository: AccountRepository) {}

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
      | 'proofs'
      | 'version'
      | 'wallet'
    >;
  }) {
    const isTestMint = await checkIsTestMint(account.mintUrl);

    return this.accountRepository.create<CashuAccount>({
      ...account,
      userId,
      isTestMint,
      keysetCounters: {},
      proofs: [],
    });
  }
}

export function useAccountService() {
  const accountRepository = useAccountRepository();
  return new AccountService(accountRepository);
}
