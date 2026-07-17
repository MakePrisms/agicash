import type { Account, ExtendedAccount } from '../accounts/account';
import type { User } from './user';
import type { UpdateUserRepository } from './user-repository';

type SetDefaultAccountOptions = {
  /**
   * Whether to set the user'sdefault currency to the account's currency.
   */
  setDefaultCurrency?: boolean;
  abortSignal?: AbortSignal;
};

export class UserService {
  constructor(private readonly userRepository: UpdateUserRepository) {}

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
        isDefault: UserService.isDefaultAccount(user, account),
      }))
      .sort((_, b) => (b.isDefault ? 1 : -1)); // Sort the default account to the top;
  }

  /**
   * Sets the account as the user's default account for the respective currency.
   * If setDefaultCurrency option is set to true, the user's default currency will also be set to the account's currency.
   * Writes only the changed columns, so concurrent changes to the other
   * defaults can't be clobbered by stale caller state.
   */
  async setDefaultAccount(
    userId: string,
    account: Account,
    options: SetDefaultAccountOptions = {
      setDefaultCurrency: false,
    },
  ): Promise<User> {
    if (!['BTC', 'USD'].includes(account.currency)) {
      throw new Error('Unsupported currency');
    }

    return this.userRepository.update(
      userId,
      {
        ...(account.currency === 'BTC'
          ? { defaultBtcAccountId: account.id }
          : { defaultUsdAccountId: account.id }),
        ...(options.setDefaultCurrency
          ? { defaultCurrency: account.currency }
          : {}),
      },
      { abortSignal: options.abortSignal },
    );
  }
}
