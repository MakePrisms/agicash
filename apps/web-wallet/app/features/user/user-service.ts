import type { Account } from '../accounts/account';
import type { User } from './user';
import type { WriteUserRepository } from './user-repository';

type SetDefaultAccountOptions = {
  /**
   * Whether to set the user'sdefault currency to the account's currency.
   */
  setDefaultCurrency?: boolean;
  abortSignal?: AbortSignal;
};

export class UserService {
  constructor(private readonly userRepository: WriteUserRepository) {}

  /**
   * Sets the account as the user's default account for the respective currency.
   * If setDefaultCurrency option is set to true, the user's default currency will also be set to the account's currency.
   */
  async setDefaultAccount(
    user: User,
    account: Account,
    options: SetDefaultAccountOptions = {
      setDefaultCurrency: false,
    },
  ): Promise<User> {
    if (!['BTC', 'USD'].includes(account.currency)) {
      throw new Error('Unsupported currency');
    }

    return this.userRepository.update(
      user.id,
      {
        defaultCurrency: options.setDefaultCurrency
          ? account.currency
          : user.defaultCurrency,
        defaultBtcAccountId:
          account.currency === 'BTC' ? account.id : user.defaultBtcAccountId,
        defaultUsdAccountId:
          account.currency === 'USD' ? account.id : user.defaultUsdAccountId,
      },
      { abortSignal: options.abortSignal },
    );
  }
}
