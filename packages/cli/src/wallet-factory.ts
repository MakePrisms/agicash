import type { Database } from 'bun:sqlite';
import type { ExtendedCashuWallet } from '@agicash/sdk/lib/cashu/utils';
import { advanceCounter, loadCounters } from './counter-store';
import { getCashuSeed, hasMnemonic } from './key-provider';

/**
 * Creates a CashuWallet with persisted keyset counters.
 *
 * - Reads counters from the DB and passes them via `counterInit`
 * - Subscribes to `wallet.on.countersReserved` to persist counter advances
 * - Returns the wallet ready for use (caller must still call `loadMint`)
 */
export async function createWalletWithCounters(
  db: Database,
  accountId: string,
  mintUrl: string,
  currency: string,
): Promise<ExtendedCashuWallet> {
  const { getCashuWallet } = await import('@agicash/sdk/lib/cashu/utils');

  const unit = currency === 'BTC' ? 'sat' : ('cent' as const);
  const mnemonic = process.env.AGICASH_MNEMONIC;
  const bip39seed =
    hasMnemonic() && mnemonic ? getCashuSeed(mnemonic) : undefined;

  // Load persisted counters from DB
  const counterInit = bip39seed ? loadCounters(db, accountId) : undefined;

  const wallet = getCashuWallet(mintUrl, { unit, bip39seed, counterInit });

  // Subscribe to counter reservation events to persist them
  if (bip39seed) {
    wallet.on.countersReserved(({ keysetId, next }) => {
      advanceCounter(db, accountId, keysetId, next);
    });
  }

  return wallet;
}
