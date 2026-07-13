import type { Account, CashuAccount, SparkAccount } from '../../sdk/accounts';
import {
  type Account as DomainAccount,
  type CashuAccount as DomainCashuAccount,
  type SparkAccount as DomainSparkAccount,
  getAccountBalance,
} from './account';

/**
 * The single domain→projection mapper: the only sanctioned way an account
 * object enters the host's `['accounts']` cache (list/get queryFn, realtime
 * row mapping, `cashu.add` onSuccess, `user.ensure` seed).
 *
 * It attaches the computed `balance` and returns the projection type, which
 * strips `wallet`/`proofs`/`keysetCounters` at the type level. During the
 * migration the returned object stays runtime-fat: the hidden domain fields
 * ride along unread, reachable only through `/temporary`'s `toDomainAccount`.
 * The strip becomes physical at step 18. Built fresh over the public fields —
 * the domain `RedactedAccount` is not a base here (it strips only `proofs`).
 */
export function toAccountProjection(account: DomainCashuAccount): CashuAccount;
export function toAccountProjection(account: DomainSparkAccount): SparkAccount;
export function toAccountProjection(account: DomainAccount): Account;
export function toAccountProjection(account: DomainAccount): Account {
  if (account.type === 'cashu') {
    return { ...account, balance: getAccountBalance(account) };
  }
  return account;
}
