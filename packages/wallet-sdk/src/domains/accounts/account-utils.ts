import { Money } from '@agicash/money';
import { getCashuUnit, sumProofs } from '../../internal/lib/cashu';
import type { Account, ExtendedAccount } from '../../types/account';
import type { User } from '../../types/user';

/** The account's balance: cashu = Σ proofs; spark = its tracked balance (nullable). */
export function getAccountBalance(account: Account): Money | null {
  if (account.type === 'cashu') {
    return new Money({
      amount: sumProofs(account.proofs),
      currency: account.currency,
      unit: getCashuUnit(account.currency),
    });
  }
  return account.balance;
}

/** Whether the account can SEND over Lightning (spark always; cashu gated on NUT-05 + flags). */
export function canSendToLightning(account: Account): boolean {
  if (account.type === 'spark') return true;
  if (account.isTestMint) return false;
  if (account.purpose !== 'transactional') return false;
  if (!account.isOnline) return false;
  return !account.wallet.getMintInfo().isSupported(5).disabled;
}

/** Whether the account can RECEIVE over Lightning (spark always; cashu gated on NUT-04 + flags). */
export function canReceiveFromLightning(account: Account): boolean {
  if (account.type === 'spark') return true;
  if (account.isTestMint) return false;
  if (!account.isOnline) return false;
  return !account.wallet.getMintInfo().isSupported(4).disabled;
}

/** True if `account` is the user's default for its currency. */
export function isDefaultAccount(user: User, account: Account): boolean {
  if (account.currency === 'BTC') return user.defaultBtcAccountId === account.id;
  if (account.currency === 'USD') return user.defaultUsdAccountId === account.id;
  return false;
}

/** Tag each account with `isDefault` and sort defaults to the top. */
export function getExtendedAccounts(
  user: User,
  accounts: Account[],
): ExtendedAccount[] {
  return accounts
    .map((account) => ({ ...account, isDefault: isDefaultAccount(user, account) }))
    .sort((_, b) => (b.isDefault ? 1 : -1)) as ExtendedAccount[];
}
