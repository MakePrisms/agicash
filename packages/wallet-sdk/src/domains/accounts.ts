/**
 * `AccountsDomain` implementation — §2 of the contract, Slice 2 (reactive overlay, design B).
 *
 * EXTRACTED (re-housed framework-free) from `apps/web-wallet/app/features/accounts/*`
 * (`account-repository.ts` / `account-service.ts` / `account-hooks.ts`) +
 * `app/features/user/user-service.ts` (the default-account write). Master expresses these as
 * React hooks over a TanStack `AccountsCache`.
 *
 * REACTIVE OVERLAY: TanStack is no longer in the consumer — it is hidden inside the SDK.
 *  - `list()` / `get(id)` / `getDefault(params?)` are OBSERVABLE FETCHES → each returns a
 *    `Query<T>`. The fetch BODY is identical to the no-cache read (the DB read via the
 *    account repository + session); it is wrapped via {@link toQuery} over the SDK-internal
 *    `QueryClient` and MEMOISED per key (`#q`) so repeated calls return the SAME stable
 *    `Query` ref (matching the per-key-memo pattern the other reactive domains use).
 *    Parameterised reads (`get(id)`, `getDefault({currency})`) memo one `Query` per
 *    id/currency. Realtime / orchestrators (Slice 5) write the same client (e.g.
 *    `setQueryData(['accounts'], next)`) to push fresh values to subscribers.
 *  - `getBalance(account)` is a PURE DERIVATION → stays SYNC. It sums proofs (cashu) / reads
 *    `account.balance` (spark) over the account it is handed; it never reads the cache, so it
 *    is NOT wrapped in `toQuery`.
 *  - `suggestFor(intent, accounts)` is a PURE pick over the passed-in accounts → stays SYNC.
 *  - `add(...)` / `setDefault(account)` are WRITES → stay `Promise` (lifted verbatim).
 *
 * Two-mode API rule (Josip 6/01): `list`/`get`/`getDefault` are FETCHES; `add` CREATES;
 * `setDefault`/`getBalance` take the FULL account object; `suggestFor` is PURE over the
 * passed-in accounts.
 *
 * Slice boundary (build plan): an account's LIVE `wallet` handle + decrypted cashu `proofs`
 * are resolved through the injected handle resolver, which is DEFERRED to Slice 3 (the heavy
 * mint/Breez init + the `shared/encryption` proof decryption). This slice owns the DB
 * read/write, scan, and the pure suggester; reads return real accounts with the DB fields,
 * with the live handle filled in by Slice 3. See `internal/account-handle-resolver.ts`.
 *
 * @module
 */
import type { AccountsDomain, AccountSuggestion } from '../domains';
import { getAccountBalance } from '../internal/account-balance';
import type { AccountRepository } from '../internal/account-repository';
import type { SessionResolver } from '../internal/session';
import { suggestAccountFor } from '../internal/suggest-account';
import type { UserRepository } from '../internal/user-repository';
import { type QueryClient, toQuery } from '../query';
import type { Account, AddAccountConfig } from '../types/account';
import { type Currency, Money } from '../types/money';
import type { Query } from '../types/query';
import type { PaymentIntent } from '../types/scan';

/** Stable query-key prefix for the active-accounts list (one per SDK instance). */
const ACCOUNTS_KEY = 'accounts';
/** Stable query-key prefix for a single account by id. */
const ACCOUNT_KEY = 'account';
/** Stable query-key prefix for the default account (parameterised by currency). */
const ACCOUNTS_DEFAULT_KEY = 'accounts:default';

/**
 * The accounts domain. Construct with the SDK-internal `QueryClient` (backs the observable
 * reads), the account repository (DB read/write), the user repository (default-account
 * read/write lives on the `wallet.users` row), and the session resolver (current user id +
 * default-account ids).
 */
export class AccountsDomainImpl implements AccountsDomain {
  /**
   * Per-key memo of the `Query` handles this domain exposes, so repeated calls with the same
   * arguments return the SAME stable reference (consumers can use it as a
   * `useSyncExternalStore`/effect dependency). Hidden inside the SDK.
   */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Query<T> memo, keyed by string
  readonly #q = new Map<string, Query<any>>();

  /**
   * @param client - the SDK-internal TanStack `QueryClient` (never exposed to consumers).
   * @param accounts - the `wallet.accounts` repository.
   * @param users - the `wallet.users` repository (default-account columns).
   * @param session - resolves the current user (id + default-account ids).
   */
  constructor(
    private readonly client: QueryClient,
    private readonly accounts: AccountRepository,
    private readonly users: UserRepository,
    private readonly session: SessionResolver,
  ) {}

  /**
   * Memoise a `Query` per stringified key: the FIRST call for a key builds the `Query` via
   * {@link toQuery}; later calls return the same stable ref. Mirrors the per-key-memo the
   * other reactive domains use (e.g. `user.getCurrentUser`).
   */
  #memo<T>(key: readonly unknown[], fn: () => Promise<T>): Query<T> {
    const id = JSON.stringify(key);
    let q = this.#q.get(id);
    if (!q) {
      q = toQuery<T>(this.client, key, fn);
      this.#q.set(id, q);
    }
    return q;
  }

  /**
   * All of the user's active accounts — as an observable {@link Query}. Re-houses master
   * `useAccounts` / `getAllActive`; sorted oldest-first (matching master's creation-date
   * sort). The fetch body is the no-cache read (session → `accounts.getAllActive`); the
   * reactive overlay wraps it in a {@link toQuery}-backed `Query` (memoised per key).
   *
   * @returns a stable `Query<Account[]>`.
   */
  list(): Query<Account[]> {
    return this.#memo([ACCOUNTS_KEY], async () => {
      const user = await this.session.requireCurrentUser();
      const accounts = await this.accounts.getAllActive(user.id);
      return accounts.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    });
  }

  /**
   * The account with this id, or `null` — as an observable {@link Query}. Re-houses master
   * `AccountRepository.get` (the lazy DB lookup behind `useAccountOrNull`), so it returns
   * expired accounts too. Memoised per id (one `Query` per distinct id).
   *
   * @param id - the account id.
   * @returns a stable `Query<Account | null>`.
   */
  get(id: string): Query<Account | null> {
    return this.#memo([ACCOUNT_KEY, id], () => this.accounts.get(id));
  }

  /**
   * The user's default account for a currency, or `null` — as an observable {@link Query}.
   * Re-houses master `useDefaultAccount`: reads the default-account id off the current user
   * (`defaultBtcAccountId` / `defaultUsdAccountId`, by currency; `currency` defaults to the
   * user's `defaultCurrency`) and fetches that account. Returns `null` when no default is
   * set / the account is missing. Memoised per requested currency (with a distinct key for
   * the "user's default currency" case).
   *
   * @param params - optional `{ currency }`; defaults to the user's default currency.
   * @returns a stable `Query<Account | null>`.
   */
  getDefault(params?: { currency?: Currency }): Query<Account | null> {
    const currencyKey = params?.currency ?? 'auto';
    return this.#memo([ACCOUNTS_DEFAULT_KEY, currencyKey], async () => {
      const user = await this.session.requireCurrentUser();
      const currency = params?.currency ?? user.defaultCurrency;

      const defaultId =
        currency === 'BTC'
          ? user.defaultBtcAccountId
          : currency === 'USD'
            ? user.defaultUsdAccountId
            : null;

      if (!defaultId) {
        return null;
      }
      return this.accounts.get(defaultId);
    });
  }

  /**
   * Create and persist a new account (create). Re-houses master
   * `account-service.addCashuAccount` + `account-repository.create`. An ACTION → `Promise`.
   *
   * @param config - the cashu (mintUrl+currency) or spark (currency) create config.
   * @returns the created account.
   */
  async add(config: AddAccountConfig): Promise<Account> {
    const user = await this.session.requireCurrentUser();
    return this.accounts.add(user.id, config);
  }

  /**
   * Make `account` the default for its currency (FULL object). Re-houses master
   * `user-service.setDefaultAccount`: writes the matching default-account column on the
   * `wallet.users` row (BTC→`defaultBtcAccountId`, USD→`defaultUsdAccountId`), leaving the
   * other currency's default + the user's `defaultCurrency` unchanged. There is one default
   * PER currency, not a single global default. An ACTION → `Promise`.
   *
   * @param account - the account to make default.
   * @throws Error if the account's currency is unsupported.
   */
  async setDefault(account: Account): Promise<void> {
    if (account.currency !== 'BTC' && account.currency !== 'USD') {
      throw new Error('Unsupported currency');
    }
    const user = await this.session.requireCurrentUser();
    await this.users.setDefaultAccount(user.id, {
      defaultBtcAccountId:
        account.currency === 'BTC' ? account.id : user.defaultBtcAccountId,
      defaultUsdAccountId:
        account.currency === 'USD' ? account.id : user.defaultUsdAccountId,
      // setDefault changes the default ACCOUNT for the currency, not the user's preferred
      // currency (master's `setDefaultCurrency` option defaults to false).
      defaultCurrency: user.defaultCurrency,
    });
  }

  /**
   * The current balance of `account` (FULL object). PURE derivation → SYNC (no re-read, not
   * wrapped in `toQuery`): cashu = sum of proofs, spark = the `balance` field. Re-houses
   * master `getAccountBalance`.
   *
   * @param account - the account.
   * @returns the balance as {@link Money} (zero for an empty cashu account; a spark account
   *   with no known balance resolves to zero in its currency).
   */
  getBalance(account: Account): Money {
    const balance = getAccountBalance(account);
    return balance ?? Money.zero(account.currency);
  }

  /**
   * Recommend which of the passed-in `accounts` to use for `intent`. PURE → SYNC (no DB read,
   * no live-wallet call, not wrapped in `toQuery`). NET-NEW logic; generalizes master's
   * `findMatchingOfferOrGiftCardAccount` + online filter + default fallback. The web wallet
   * feeds its cached accounts for an instant result.
   *
   * Pure over the accounts handed in: the cheap-first ranking and the online/balance filters
   * read only the passed-in `accounts`. (The no-cache impl additionally read the current
   * session to seed the default-account fallback; the reactive contract types this method
   * SYNC and pure over `accounts`, so the session read is dropped — when nothing has
   * sufficient balance the fallback degrades to the first insufficient account, exactly as
   * the underlying pure suggester does with no default id.)
   *
   * @param intent - what the user wants to do.
   * @param accounts - the accounts to choose from.
   * @returns the {@link AccountSuggestion}.
   */
  suggestFor(intent: PaymentIntent, accounts: Account[]): AccountSuggestion {
    return suggestAccountFor(intent, accounts);
  }
}
