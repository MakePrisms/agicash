import type { Currency } from '@agicash/money';
import type { Account } from '../domains/account-types';
import type { AccountsDomain } from '../domains/accounts';
import type { User } from '../domains/user-types';
import type { Store } from '../internal/engine';

type Deps = {
  base: AccountsDomain;
  accountsStore: Store<Account[]>;
  getUser: () => Promise<User | null>;
};

export type StoreAccounts = AccountsDomain & {
  all: Store<Account[]>;
  list(): Promise<Account[]>;
  getDefault(currency?: Currency): Promise<Account>;
};

/** Variant-B accounts surface: the `all` Store (the hot read), a Promise `list()`
 * (load-before-serve via the store), and getDefault with the 6b first-of-currency
 * fallback (matches the app's useDefaultAccount). */
export function createStoreAccounts(deps: Deps): StoreAccounts {
  const list = async (): Promise<Account[]> => deps.accountsStore.toPromise();

  const getDefault = async (currency?: Currency): Promise<Account> => {
    try {
      return await deps.base.getDefault(currency);
    } catch (error) {
      const user = await deps.getUser();
      const target = currency ?? user?.defaultCurrency;
      const candidates = (await deps.accountsStore.toPromise())
        .filter((a) => a.currency === target)
        .sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
      const fallback = candidates[0];
      if (!fallback) throw error;
      return fallback;
    }
  };

  return new Proxy(deps.base, {
    get(targetBase, prop, receiver) {
      if (prop === 'all') return deps.accountsStore;
      if (prop === 'list') return list;
      if (prop === 'getDefault') return getDefault;
      return Reflect.get(targetBase, prop, receiver);
    },
  }) as unknown as StoreAccounts;
}
