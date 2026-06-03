/**
 * `getAccountBalance` — pure account-balance derivation (Slice 2).
 *
 * Lifted verbatim from `apps/web-wallet/app/features/accounts/account.ts#getAccountBalance`:
 * a cashu account's balance is the sum of its proof amounts (in the cashu unit for the
 * currency); a spark account's balance is its `balance` field (sourced from the Breez SDK,
 * may be `null` when offline / not yet known). Pure — no DB read, no live-wallet call — so
 * it backs both `accounts.getBalance` (full object) and the `suggestFor` ranking.
 *
 * NOTE on the Slice-2 deferral: a cashu account's `proofs` are populated by the account
 * handle resolver, which is deferred to Slice 3 (the Slice-2 stub yields `proofs: []`). So
 * for a cashu account built in this slice this returns a zero balance until Slice 3 wires
 * proof decryption; a spark account's `balance` is likewise `null` until Slice 3. This is
 * the documented PR4 boundary — the function itself is the verbatim, final logic.
 *
 * @module
 */
import { getCashuUnit, sumProofs } from './lib-cashu';
import { Money } from '../types/money';
import type { Account } from '../types/account';

/**
 * The balance of an account.
 *
 * - cashu: `sum(proofs.amount)` as {@link Money} in the currency's cashu unit.
 * - spark: the account's `balance` (possibly `null`).
 *
 * @param account - the account.
 * @returns the balance as {@link Money}, or `null` for a spark account with no known balance.
 */
export function getAccountBalance(account: Account): Money | null {
  if (account.type === 'cashu') {
    const value = sumProofs(account.proofs);
    return new Money({
      amount: value,
      currency: account.currency,
      unit: getCashuUnit(account.currency),
    });
  }
  return account.balance;
}
