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

// The hidden domain fields each rail must carry for a projection to be
// unwrapped back to a domain account during migration.
const hiddenFieldsByType = {
  cashu: ['proofs', 'wallet', 'keysetCounters'],
  spark: ['wallet'],
} as const;

/** Thrown when {@link toDomainAccount} is handed a projection that lost its runtime-fat domain fields. */
export class MissingDomainFieldsError extends Error {
  constructor(accountType: string, missingFields: readonly string[]) {
    super(
      `Cannot unwrap ${accountType} account to a domain account: missing hidden field(s) ${missingFields.join(
        ', ',
      )}. A projection reached an unwrap site without the runtime-fat migration representation.`,
    );
    this.name = 'MissingDomainFieldsError';
  }
}

/**
 * Checked unwrap from a public projection back to the fat domain account, for
 * the getter hooks that still read wallet/proofs/keysetCounters off the cache.
 * Asserts the runtime-fat fields are present and throws
 * {@link MissingDomainFieldsError} naming the missing ones — never a bare cast,
 * so a mapper bug that produced a thin object fails loudly here instead of
 * exploding later in a money path expecting `.wallet`/`.proofs`.
 *
 * @remarks Removed at step 18 when the projection strip becomes physical.
 */
export function toDomainAccount(account: Account): DomainAccount {
  const missing = hiddenFieldsByType[account.type].filter(
    (field) => !(field in account),
  );
  if (missing.length > 0) {
    throw new MissingDomainFieldsError(account.type, missing);
  }
  return account as unknown as DomainAccount;
}
