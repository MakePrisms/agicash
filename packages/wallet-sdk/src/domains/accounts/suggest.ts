import type { Money } from '@agicash/money';
import { DomainError } from '../../errors';
import type { Account } from '../../types/account';
import type { AccountSuggestion } from '../../types/account-config';
import type { PaymentIntent } from '../../types/scan';
import {
  canReceiveFromLightning,
  canSendToLightning,
  getAccountBalance,
} from './account-utils';

/** The amount an intent needs satisfied, if known (used for the balance check). */
function intentAmount(intent: PaymentIntent): Money | undefined {
  if (intent.kind === 'send') return intent.amount;
  if (intent.kind === 'receive') return intent.amount;
  return undefined; // token-receive: amount is inside the token
}

/** Rank: offer first, then gift-card, then input-array order (caller orders default-first). */
function purposeRank(account: Account): number {
  if (account.purpose === 'offer') return 0;
  if (account.purpose === 'gift-card') return 1;
  return 2;
}

/**
 * Recommend which of the passed-in `accounts` to use for `intent`. PURE — no DB
 * read, no rate fetch, no cross-protocol cost comparison. Filters by ability
 * (send → canSendToLightning; receive/token-receive → canReceiveFromLightning),
 * then partitions by SAME-CURRENCY sufficient balance, ranks offer > gift-card >
 * input order, and recommends the top sufficient candidate. The caller is
 * responsible for passing accounts default-first and for any gift-card-config
 * destination matching (web-side). Throws `DomainError` when nothing can serve.
 */
export function suggestForAccounts(
  intent: PaymentIntent,
  accounts: Account[],
): AccountSuggestion {
  const canUse =
    intent.kind === 'send' ? canSendToLightning : canReceiveFromLightning;
  const candidates = accounts.filter(canUse);

  if (candidates.length === 0) {
    throw new DomainError(
      'No account can service this payment',
      'NO_SUITABLE_ACCOUNT',
    );
  }

  const amount = intentAmount(intent);
  const hasSufficientBalance = (account: Account): boolean => {
    const balance = getAccountBalance(account);
    if (!balance) return false;
    if (!amount) return intent.kind === 'send' ? balance.isPositive() : true;
    // Same-currency comparison only (no conversion in a pure heuristic).
    if (account.currency !== amount.currency) return true;
    return balance.greaterThanOrEqual(amount);
  };

  const ranked = [...candidates].sort(
    (a, b) => purposeRank(a) - purposeRank(b),
  );
  const sufficient = ranked.filter(hasSufficientBalance);
  const insufficient = ranked.filter((a) => !hasSufficientBalance(a));

  if (sufficient.length === 0) {
    throw new DomainError(
      'No account has sufficient balance for this payment',
      'INSUFFICIENT_BALANCE',
    );
  }

  const [recommended, ...alternatives] = sufficient;
  const reason =
    recommended.purpose === 'offer'
      ? 'offer match'
      : recommended.purpose === 'gift-card'
        ? 'gift-card-mint match'
        : `default ${recommended.type}`;

  return { recommended, alternatives, insufficient, reason };
}
