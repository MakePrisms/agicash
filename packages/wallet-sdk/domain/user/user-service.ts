import type { Currency } from '@agicash/money';
import type { Account } from '../accounts/account';
import type { User } from './user';
import type { WriteUserRepository } from './user-repository';

type UserDefaults = Pick<User, 'defaultBtcAccountId' | 'defaultUsdAccountId'>;

/**
 * Returns true if the account is the user's default account for its currency.
 * Pure over public fields, so it accepts both domain and projection accounts.
 */
export function isDefaultAccount(
  user: UserDefaults,
  account: { id: string; currency: Currency },
): boolean {
  if (account.currency === 'BTC') {
    return user.defaultBtcAccountId === account.id;
  }
  if (account.currency === 'USD') {
    return user.defaultUsdAccountId === account.id;
  }
  return false;
}

/**
 * Attaches `isDefault` to each account and sorts the default account to the top.
 * Generic over the account shape (domain or projection): it reads only public
 * fields and preserves the input element type.
 *
 * The generic signature exists only while domain and projection accounts
 * coexist; at step 18 (physical projection strip) it reverts to
 * `(user: User, accounts: Account[]): ExtendedAccount[]`.
 */
export function getExtendedAccounts<
  A extends { id: string; currency: Currency },
>(user: UserDefaults, accounts: A[]): (A & { isDefault: boolean })[] {
  return accounts
    .map((account): A & { isDefault: boolean } => ({
      ...account,
      isDefault: isDefaultAccount(user, account),
    }))
    .sort((_, b) => (b.isDefault ? 1 : -1));
}

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
   * Writes only the changed columns, so concurrent changes to the other
   * defaults can't be clobbered by stale caller state.
   */
  async setDefaultAccount(
    user: Pick<User, 'id'>,
    account: Pick<Account, 'id' | 'currency'>,
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
