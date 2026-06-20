import type { Currency } from '@agicash/money';
import type { Account } from '../domains/account-types';
import type { AccountsDomain } from '../domains/accounts';
import type { User } from '../domains/user-types';
import type { ResidentAccounts } from './resident-accounts';

type Deps = {
  base: AccountsDomain;
  accounts: ResidentAccounts;
  getUser: () => Promise<User | null>;
};

export type StatelessAccounts = AccountsDomain & {
  list(): Promise<Account[]>;
  getDefault(currency?: Currency): Promise<Account>;
};

/** Wraps the base AccountsDomain with Variant A's resident `list()` and the
 * 6b carry: getDefault falls back to the first (earliest-created) account of the
 * target currency before throwing, matching the app's useDefaultAccount. */
export function createStatelessAccounts(deps: Deps): StatelessAccounts {
  // The read surface must be self-sufficient: load the resident map on demand
  // (idempotent — no-ops once loaded) rather than relying on background.start /
  // leader-activate having populated it. Otherwise the first wallet render reads
  // an empty map and useDefaultAccount throws "No default account found".
  const list = async (): Promise<Account[]> => {
    const user = await deps.getUser();
    if (user) await deps.accounts.ensureLoaded(user.id);
    return deps.accounts.all();
  };

  const getDefault = async (currency?: Currency): Promise<Account> => {
    try {
      return await deps.base.getDefault(currency);
    } catch (error) {
      const user = await deps.getUser();
      if (user) await deps.accounts.ensureLoaded(user.id);
      const target = currency ?? user?.defaultCurrency;
      const candidates = deps.accounts
        .all()
        .filter((a) => a.currency === target)
        .sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
      const fallback = candidates[0];
      if (!fallback) throw error;
      return fallback;
    }
  };

  // Preserve every other AccountsDomain method (get/suggestFor/add) by delegation.
  return new Proxy(deps.base, {
    get(targetBase, prop, receiver) {
      if (prop === 'list') return list;
      if (prop === 'getDefault') return getDefault;
      return Reflect.get(targetBase, prop, receiver);
    },
  }) as unknown as StatelessAccounts;
}
