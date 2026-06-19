import type {
  ReadUserRepository,
  WriteUserRepository,
} from '../internal/db/user-repository';
import type { Currency } from '@agicash/money';
import type { Account } from './account-types';
import type { User } from './user-types';

type Deps = {
  readUserRepo: ReadUserRepository;
  writeUserRepo: WriteUserRepository;
  /** Resolves the current user's id, or null when signed out. */
  getCurrentUserId: () => Promise<string | null>;
};

/**
 * The `user` domain. `get()` is the current-user hot read (Promise-based in both
 * variants). `setDefaultAccount` sets the default account for the account's
 * currency and, when `setDefaultCurrency` is passed, also makes that the
 * default currency; a DB constraint requires a default account to exist for a
 * currency before it can be made the default, so passing `setDefaultCurrency`
 * can reject with UniqueConstraintError (surfaced from the repo unchanged).
 * `acceptTerms` records acceptance timestamps for the wallet terms and/or the
 * gift-card mint terms independently, depending on which flags are passed.
 */
export class UserDomain {
  constructor(private readonly deps: Deps) {}

  /** The current user, or null when signed out. */
  async get(): Promise<User | null> {
    const id = await this.deps.getCurrentUserId();
    if (!id) return null;
    return this.deps.readUserRepo.get(id);
  }

  async setDefaultAccount(params: {
    account: Account;
    setDefaultCurrency?: boolean;
  }): Promise<User> {
    const id = await this.requireUserId();
    const { account, setDefaultCurrency } = params;
    if (account.currency !== 'BTC' && account.currency !== 'USD') {
      throw new Error('Unsupported currency');
    }
    return this.deps.writeUserRepo.update(id, {
      ...(account.currency === 'BTC'
        ? { defaultBtcAccountId: account.id }
        : { defaultUsdAccountId: account.id }),
      ...(setDefaultCurrency ? { defaultCurrency: account.currency } : {}),
    });
  }

  async setDefaultCurrency(currency: Currency): Promise<User> {
    const id = await this.requireUserId();
    return this.deps.writeUserRepo.update(id, { defaultCurrency: currency });
  }

  async updateUsername(username: string): Promise<User> {
    const id = await this.requireUserId();
    return this.deps.writeUserRepo.update(id, { username });
  }

  async acceptTerms(params: {
    walletTerms?: boolean;
    giftCardTerms?: boolean;
  }): Promise<User> {
    const id = await this.requireUserId();
    const now = new Date().toISOString();
    return this.deps.writeUserRepo.update(id, {
      ...(params.walletTerms ? { termsAcceptedAt: now } : {}),
      ...(params.giftCardTerms ? { giftCardMintTermsAcceptedAt: now } : {}),
    });
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
