import type { FetchQueryOptions } from '@tanstack/query-core';
import type { QueryClient } from '@tanstack/query-core';
import { accountsQueryKey } from '../../core/query-keys';
import { Money } from '../../lib/money';
import type { Account, SparkAccount } from './account';
import type { AccountRepository } from './account-repository';

export class AccountsCache {
  public static Key = 'accounts';

  constructor(private readonly queryClient: QueryClient) {}

  upsert(account: Account) {
    this.queryClient.setQueryData<Account[]>(
      accountsQueryKey(),
      (curr = []) => {
        const existingAccountIndex = curr.findIndex((x) => x.id === account.id);
        if (existingAccountIndex !== -1) {
          return curr.map((x) =>
            x.id === account.id && account.version > x.version ? account : x,
          );
        }
        return [...curr, account];
      },
    );
  }

  update(account: Account) {
    this.queryClient.setQueryData<Account[]>(accountsQueryKey(), (curr = []) =>
      curr.map((x) =>
        x.id === account.id && account.version > x.version ? account : x,
      ),
    );
  }

  updateSparkAccountIfBalanceOrWalletChanged(account: SparkAccount) {
    this.queryClient.setQueryData<Account[]>(accountsQueryKey(), (curr = []) =>
      curr.map((x) =>
        x.id === account.id &&
        x.type === 'spark' &&
        account.version >= x.version &&
        this.hasDifferentBalanceOrWallet(x, account)
          ? account
          : x,
      ),
    );
  }

  private hasDifferentBalanceOrWallet(
    accountOne: SparkAccount,
    accountTwo: SparkAccount,
  ) {
    const oneOwned = accountOne.ownedBalance ?? Money.zero(accountOne.currency);
    const twoOwned = accountTwo.ownedBalance ?? Money.zero(accountTwo.currency);
    const oneAvailable =
      accountOne.availableBalance ?? Money.zero(accountOne.currency);
    const twoAvailable =
      accountTwo.availableBalance ?? Money.zero(accountTwo.currency);

    return (
      !oneOwned.equals(twoOwned) ||
      !oneAvailable.equals(twoAvailable) ||
      accountOne.wallet !== accountTwo.wallet
    );
  }

  getAll() {
    return this.queryClient.getQueryData<Account[]>(accountsQueryKey());
  }

  get(id: string) {
    const accounts = this.getAll();
    return accounts?.find((x) => x.id === id) ?? null;
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: accountsQueryKey(),
    });
  }
}

export const listAccountsQuery = ({
  userId,
  accountRepository,
}: {
  userId: string;
  accountRepository: AccountRepository;
}) =>
  ({
    queryKey: accountsQueryKey(),
    queryFn: () => accountRepository.getAll(userId),
    staleTime: Number.POSITIVE_INFINITY,
  }) satisfies FetchQueryOptions<Account[], Error>;
