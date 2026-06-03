/**
 * `AccountsDomain` implementation — §2 of the contract, Slice 2.
 *
 * EXTRACTED (re-housed framework-free) from `apps/web-wallet/app/features/accounts/*`
 * (`account-repository.ts` / `account-service.ts` / `account-hooks.ts`) +
 * `app/features/user/user-service.ts` (the default-account write). Master expresses these as
 * React hooks over a TanStack `AccountsCache`; the SDK exposes them as plain async methods
 * over the SDK-owned Supabase client (no cache — events drive the consumer's read-model).
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
import { getAccountBalance } from '../internal/account-balance';
import type { AccountRepository } from '../internal/account-repository';
import type { SessionResolver } from '../internal/session';
import { suggestAccountFor } from '../internal/suggest-account';
import type { UserRepository } from '../internal/user-repository';
import type { AccountsDomain } from '../domains';
import type { Account } from '../types/account';
import type {
  AccountSuggestion,
  AddAccountConfig,
} from '../types/account-config';
import { type Currency, Money } from '../types/money';
import type { PaymentIntent } from '../types/scan';

/**
 * The accounts domain. Construct with the account repository (DB read/write), the user
 * repository (default-account read/write lives on the `wallet.users` row), and the session
 * resolver (current user id + default-account ids).
 */
export class AccountsDomainImpl implements AccountsDomain {
  /**
   * @param accounts - the `wallet.accounts` repository.
   * @param users - the `wallet.users` repository (default-account columns).
   * @param session - resolves the current user (id + default-account ids).
   */
  constructor(
    private readonly accounts: AccountRepository,
    private readonly users: UserRepository,
    private readonly session: SessionResolver,
  ) {}

  /**
   * All of the user's active accounts (fetch). Re-houses master `useAccounts` /
   * `getAllActive`. Sorted oldest-first (matching master's creation-date sort).
   *
   * @returns the active accounts.
   */
  async list(): Promise<Account[]> {
    const user = await this.session.requireCurrentUser();
    const accounts = await this.accounts.getAllActive(user.id);
    return accounts.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  /**
   * The account with this id, or null (fetch). Re-houses master `AccountRepository.get`
   * (the lazy DB lookup behind `useAccountOrNull`), so it returns expired accounts too.
   *
   * @param id - the account id.
   * @returns the account, or null.
   */
  async get(id: string): Promise<Account | null> {
    return this.accounts.get(id);
  }

  /**
   * The user's default account for a currency (fetch). Re-houses master `useDefaultAccount`:
   * reads the default-account id off the current user (`defaultBtcAccountId` /
   * `defaultUsdAccountId`, by currency; `currency` defaults to the user's `defaultCurrency`)
   * and fetches that account. Returns null when no default is set / the account is missing.
   *
   * @param params - optional `{ currency }`; defaults to the user's default currency.
   * @returns the default account, or null.
   */
  async getDefault(params?: { currency?: Currency }): Promise<Account | null> {
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
  }

  /**
   * Create and persist a new account (create). Re-houses master
   * `account-service.addCashuAccount` + `account-repository.create`.
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
   * PER currency, not a single global default.
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
   * The current balance of `account` (FULL object). Pure derivation (no re-read): cashu =
   * sum of proofs, spark = the `balance` field. Re-houses master `getAccountBalance`.
   *
   * @param account - the account.
   * @returns the balance as {@link Money} (zero for an empty cashu account; a spark account
   *   with no known balance resolves to zero in its currency).
   */
  async getBalance(account: Account): Promise<Money> {
    const balance = getAccountBalance(account);
    return balance ?? Money.zero(account.currency);
  }

  /**
   * Recommend which of the passed-in `accounts` to use for `intent` (PURE — no DB read).
   * NET-NEW logic; generalizes master's `findMatchingOfferOrGiftCardAccount` + online filter
   * + default fallback. The web wallet feeds its cached accounts for an instant result.
   *
   * Resolves the user's default-account id (for the fallback when nothing has sufficient
   * balance) from the current session — the only non-pure touch, and it is read-only and
   * optional (the core ranking is pure over the accounts handed in).
   *
   * @param intent - what the user wants to do.
   * @param accounts - the accounts to choose from.
   * @returns the {@link AccountSuggestion}.
   */
  async suggestFor(
    intent: PaymentIntent,
    accounts: Account[],
  ): Promise<AccountSuggestion> {
    const user = await this.session.getCurrentUser();
    const currency = inferIntentCurrency(intent, user?.defaultCurrency);
    const defaultAccountId = user
      ? currency === 'USD'
        ? (user.defaultUsdAccountId ?? undefined)
        : (user.defaultBtcAccountId ?? undefined)
      : undefined;
    return suggestAccountFor(intent, accounts, defaultAccountId);
  }
}

/**
 * The currency the `suggestFor` fallback should look up a default account for: a BTC
 * Lightning send → BTC; otherwise the user's default currency (or BTC when unknown).
 */
function inferIntentCurrency(
  intent: PaymentIntent,
  defaultCurrency: Currency | undefined,
): Currency {
  if (intent.kind === 'send') {
    const { destination } = intent;
    if (destination.kind === 'bolt11' || destination.kind === 'ln-address') {
      return 'BTC';
    }
  }
  return defaultCurrency ?? 'BTC';
}
