import type { Currency } from '@agicash/money';
import type { DistributedOmit } from 'type-fest';
import type { AccountRepository } from '../internal/db/account-repository';
import type { ReadUserRepository } from '../internal/db/user-repository';
import type { AccountService } from '../internal/services/account-service';
import type { Account, CashuAccount } from './account-types';

/**
 * The user-supplied fields for adding a cashu account. The SDK derives id /
 * version / state / proofs / wallet / isTestMint / keysetCounters / expiresAt.
 * Mirrors `AccountService.addCashuAccount`'s `account` parameter.
 */
export type AddCashuAccountInput = DistributedOmit<
  CashuAccount,
  | 'id'
  | 'createdAt'
  | 'expiresAt'
  | 'isTestMint'
  | 'keysetCounters'
  | 'proofs'
  | 'version'
  | 'wallet'
  | 'isOnline'
  | 'state'
>;

type Deps = {
  accountRepository: AccountRepository;
  accountService: AccountService;
  readUserRepo: ReadUserRepository;
  /** Resolves the current user's id, or null when signed out. */
  getCurrentUserId: () => Promise<string | null>;
};

/**
 * The `accounts` domain: single-account reads, the add mutation, and
 * default/suggested-account selection. The resident `list()` of all active
 * accounts is a per-variant hot read (A=Promise, B=Store), so it is not here.
 */
export class AccountsDomain {
  constructor(private readonly deps: Deps) {}

  /** A single account by id, including expired ones (DB-fallback). Null if absent. */
  get(id: string): Promise<Account | null> {
    return this.deps.accountRepository.get(id);
  }

  /**
   * The user's default account for `currency` (defaults to the user's default
   * currency). Throws if no default account is set for that currency.
   */
  async getDefault(currency?: Currency): Promise<Account> {
    const userId = await this.requireUserId();
    const user = await this.deps.readUserRepo.get(userId);
    const accountCurrency = currency ?? user.defaultCurrency;
    const defaultAccountId =
      accountCurrency === 'BTC'
        ? user.defaultBtcAccountId
        : user.defaultUsdAccountId;
    if (!defaultAccountId) {
      throw new Error(
        `No default account found for currency ${accountCurrency}`,
      );
    }
    const account = await this.deps.accountRepository.get(defaultAccountId);
    if (!account) {
      throw new Error(
        `No default account found for currency ${accountCurrency}`,
      );
    }
    return account;
  }

  /** The given account if `accountId` resolves, otherwise the default for `currency`. */
  async suggestFor(params: {
    accountId?: string;
    currency: Currency;
  }): Promise<Account> {
    if (params.accountId) {
      const account = await this.deps.accountRepository.get(params.accountId);
      if (account) return account;
    }
    return this.getDefault(params.currency);
  }

  /** Adds a cashu account for the current user. */
  async add(account: AddCashuAccountInput): Promise<CashuAccount> {
    const userId = await this.requireUserId();
    return this.deps.accountService.addCashuAccount({ userId, account });
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
