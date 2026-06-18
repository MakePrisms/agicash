import { areMintUrlsEqual, getCashuUnit } from '@agicash/cashu';
import type { Currency } from '@agicash/money';
import { NetworkError } from '@cashu/cashu-ts';
import type { WalletAccess, WalletRuntime } from '../engine';
import type {
  Account,
  CashuAccount,
  SparkAccount,
} from '../domains/account-types';
import { getInitializedCashuWallet } from '../internal/cashu/init-wallet';
import {
  type ExtendedCashuWallet,
  getCashuWallet,
} from '../internal/cashu/wallet';

/**
 * The resident account map backing Variant A's synchronous WalletAccess. Loaded
 * via `ensureLoaded`/`reload` (accountRepository.getAllActive, which returns warm
 * wallets + decrypted proofs) and kept fresh by the fanout's `account` events
 * (`upsert`). The sync getters throw on a non-resident account; `isOnline` is the
 * tolerant lookup the work-set online-filter uses (false on miss).
 */
export class ResidentAccounts implements WalletAccess {
  private readonly map = new Map<string, Account>();
  private lastUserId: string | null = null;

  constructor(private readonly runtime: WalletRuntime) {}

  async ensureLoaded(userId: string): Promise<void> {
    if (this.map.size === 0) await this.reload(userId);
  }

  async reload(userId: string): Promise<void> {
    const accounts = await this.runtime.accountRepository.getAllActive(userId);
    this.lastUserId = userId;
    this.map.clear();
    for (const account of accounts) this.map.set(account.id, account);
  }

  /** Reloads the most-recently-loaded user; no-op if no load has happened yet. */
  async reloadLast(): Promise<void> {
    if (this.lastUserId === null) return;
    await this.reload(this.lastUserId);
  }

  upsert(account: Account): void {
    this.map.set(account.id, account);
  }

  /** Every resident account, in insertion order. */
  all(): Account[] {
    return [...this.map.values()];
  }

  isOnline(accountId: string): boolean {
    return this.map.get(accountId)?.isOnline === true;
  }

  getCashuAccount(accountId: string): CashuAccount {
    const account = this.map.get(accountId);
    if (!account || account.type !== 'cashu') {
      throw new Error(`No resident cashu account ${accountId}`);
    }
    return account;
  }

  getSparkAccount(accountId: string): SparkAccount {
    const account = this.map.get(accountId);
    if (!account || account.type !== 'spark') {
      throw new Error(`No resident spark account ${accountId}`);
    }
    return account;
  }

  getCashuWalletByMint(
    mintUrl: string,
    currency: Currency,
  ): ExtendedCashuWallet {
    const resident = this.findCashuByMint(mintUrl, currency);
    if (resident) return resident.wallet;
    return getCashuWallet(mintUrl, { unit: getCashuUnit(currency) });
  }

  async getSourceCashuWallet(
    mintUrl: string,
    currency: Currency,
  ): Promise<ExtendedCashuWallet> {
    const resident = this.findCashuByMint(mintUrl, currency);
    if (resident) {
      if (!resident.isOnline) {
        throw new NetworkError(`Mint ${mintUrl} is offline`);
      }
      return resident.wallet;
    }
    const { wallet, isOnline } = await getInitializedCashuWallet({
      mintCache: this.runtime.mintCache,
      mintUrl,
      currency,
    });
    if (!isOnline) throw new NetworkError(`Mint ${mintUrl} is offline`);
    return wallet;
  }

  private findCashuByMint(
    mintUrl: string,
    currency: Currency,
  ): CashuAccount | undefined {
    for (const account of this.map.values()) {
      if (
        account.type === 'cashu' &&
        account.currency === currency &&
        areMintUrlsEqual(account.mintUrl, mintUrl)
      ) {
        return account;
      }
    }
    return undefined;
  }
}
