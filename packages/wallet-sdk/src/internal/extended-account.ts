/**
 * `getExtendedAccounts` — the PURE `isDefault` derivation (§2, Slice 2, reactive overlay).
 *
 * Re-houses master `apps/web-wallet/app/features/accounts/account-service.ts`
 * (`AccountService.isDefaultAccount` / `AccountService.getExtendedAccounts`) as standalone,
 * framework-free functions. Master expresses these as `static` methods on a class that also
 * holds a TanStack `QueryClient`; the SDK lifts only the pure derivation (no client, no DB
 * read) so the accounts reads can decorate each account with `isDefault` and so the pure
 * `suggestFor` fallback can pick the user's default account.
 *
 * `isDefault` is currency-scoped: an account is the default only for its OWN currency
 * (`defaultBtcAccountId` for a BTC account, `defaultUsdAccountId` for a USD account), so at
 * most one account per currency is flagged. The default account is sorted to the top
 * (matching master).
 *
 * @module
 */
import type { Account } from '../types/account';
import type { ExtendedAccount } from '../types/account';
import type { User } from '../types/user';

/**
 * Whether `account` is the user's default account for its currency. Mirrors master
 * `AccountService.isDefaultAccount`: a BTC account matches `defaultBtcAccountId`, a USD
 * account matches `defaultUsdAccountId`; any other currency is never the default.
 *
 * @param user - the current user (holds the per-currency default-account ids).
 * @param account - the account to test.
 * @returns `true` when this account is the default for its currency.
 */
export function isDefaultAccount(user: User, account: Account): boolean {
  if (account.currency === 'BTC') {
    return user.defaultBtcAccountId === account.id;
  }
  if (account.currency === 'USD') {
    return user.defaultUsdAccountId === account.id;
  }
  return false;
}

/**
 * Decorate `accounts` with the `isDefault` flag (per-currency default), sorting the default
 * account to the top. Mirrors master `AccountService.getExtendedAccounts`. PURE — no DB read,
 * no client; the caller supplies the resolved `user` (its default-account ids drive the flag).
 *
 * @param user - the current user (its `defaultBtcAccountId` / `defaultUsdAccountId` drive the
 *   flag).
 * @param accounts - the accounts to extend.
 * @returns the accounts as {@link ExtendedAccount}s, default-first.
 */
export function getExtendedAccounts(
  user: User,
  accounts: Account[],
): ExtendedAccount[] {
  const extended = accounts.map(
    (account): ExtendedAccount =>
      ({
        ...account,
        isDefault: isDefaultAccount(user, account),
      }) as ExtendedAccount,
  );
  // Default-first, otherwise preserve the incoming order (master sorts the default to the
  // top). A proper antisymmetric comparator: default before non-default, equal otherwise —
  // so the input order (e.g. `list`'s oldest-first sort) is preserved within each group.
  return extended.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}
