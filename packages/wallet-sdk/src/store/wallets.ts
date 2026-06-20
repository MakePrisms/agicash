import { areMintUrlsEqual, getCashuUnit } from '@agicash/cashu';
import type { Currency } from '@agicash/money';
import { NetworkError } from '@cashu/cashu-ts';
import type {
  Account,
  CashuAccount,
  SparkAccount,
} from '../domains/account-types';
import type { WalletAccess, WalletRuntime } from '../engine';
import { getInitializedCashuWallet } from '../internal/cashu/init-wallet';
import {
  type ExtendedCashuWallet,
  getCashuWallet,
} from '../internal/cashu/wallet';
import type { Store } from '../internal/engine';

/**
 * Variant-B WalletAccess: the synchronous getters read the accounts store
 * snapshot (kept fresh by the change-feed fan-out). Same resolution + fallbacks
 * + offline NetworkError behavior as Variant A's ResidentAccounts.
 */
export class StoreWalletAccess implements WalletAccess {
  constructor(
    private readonly accountsStore: Store<Account[]>,
    private readonly runtime: WalletRuntime,
  ) {}

  private all(): Account[] {
    return this.accountsStore.get() ?? [];
  }

  getCashuAccount(accountId: string): CashuAccount {
    const account = this.all().find((a) => a.id === accountId);
    if (!account || account.type !== 'cashu') {
      throw new Error(`No resident cashu account ${accountId}`);
    }
    return account;
  }

  getSparkAccount(accountId: string): SparkAccount {
    const account = this.all().find((a) => a.id === accountId);
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
      if (!resident.isOnline)
        throw new NetworkError(`Mint ${mintUrl} is offline`);
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
    return this.all().find(
      (a): a is CashuAccount =>
        a.type === 'cashu' &&
        a.currency === currency &&
        areMintUrlsEqual(a.mintUrl, mintUrl),
    );
  }
}
