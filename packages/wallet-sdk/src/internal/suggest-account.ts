/**
 * `suggestFor` — the NET-NEW, PURE account-suggestion logic (§2, Slice 2).
 *
 * There is no single backing function in master. This GENERALIZES master's
 * `apps/web-wallet/app/features/send/find-matching-offer-or-gift-card-account.ts` (a pure
 * offer/gift-card matcher over `accounts`) into a protocol-agnostic suggester, and folds in
 * the two heuristics the UI applies around it: an **online filter** (`isOnline`, which gates
 * `canSendToLightning`/`canReceiveFromLightning`) and a **default fallback** (the user's
 * default account for the currency). It is **pure over the passed-in accounts** — no DB read,
 * no live-wallet call — so the web wallet feeds its cached accounts for an instant result.
 *
 * Cheap-first, NO cross-protocol cost comparison (contract): the recommendation is the
 * highest-priority account with sufficient balance (gift-card/offer match first, then a
 * cheap-first ordering), with the remaining matches as `alternatives` and the
 * matching-but-underfunded accounts as `insufficient`. The result carries a human-readable
 * `reason`.
 *
 * Gift-card / offer accounts are out of SDK v1 (§13) and the gift-card *config* (the mint
 * destination allow-list `findMatchingOfferOrGiftCardAccount` consults) is not part of the
 * intent, so v1 cannot do destination-allow-list matching. What v1 generalizes is the
 * *priority + filter + fallback shape*: `purpose: 'offer'` > `'gift-card'` > `'transactional'`
 * is preserved as a priority ordering (so when offer/gift-card accounts DO appear they are
 * preferred, matching master), then online + sufficient-balance filtering, then the default
 * fallback. When gift-card config arrives in a later slice it slots in as a pre-filter.
 *
 * @module
 */
import { getAccountBalance } from './account-balance';
import type { Account } from '../types/account';
import type { Money } from '../types/money';
import type { ParsedDestination, PaymentIntent } from '../types/scan';
import type { AccountSuggestion } from '../types/account-config';

/** Priority by account purpose (higher = preferred), mirroring master's offer > gift-card order. */
const PURPOSE_PRIORITY: Record<Account['purpose'], number> = {
  offer: 2,
  'gift-card': 1,
  transactional: 0,
};

/**
 * The currency a send intent must be paid from, when it can be inferred from the parsed
 * destination. A BOLT11 / ln-address Lightning payment settles in BTC, so only BTC accounts
 * can fund it (mirrors master `findMatchingOfferOrGiftCardAccount`, which skips USD accounts
 * for BOLT11 melts). A cashu-token send/receive is mint-denominated and not currency-pinned
 * here. Returns `undefined` when no currency constraint applies.
 */
function requiredCurrency(
  destination: ParsedDestination | undefined,
): Account['currency'] | undefined {
  if (!destination) {
    return undefined;
  }
  if (destination.kind === 'bolt11' || destination.kind === 'ln-address') {
    return 'BTC';
  }
  return undefined;
}

/** The amount an intent needs an account to cover, or `undefined` when amountless. */
function intentAmount(intent: PaymentIntent): Money | undefined {
  if (intent.kind === 'send') {
    return intent.amount;
  }
  if (intent.kind === 'receive') {
    return intent.amount;
  }
  // token-receive: amount is encoded in the token, not constrained over accounts here.
  return undefined;
}

/**
 * Whether `account` can cover `amount`. With no amount (amountless invoice / open receive),
 * a send needs only a positive balance; a receive has no balance requirement.
 */
function hasSufficientBalance(
  account: Account,
  amount: Money | undefined,
  isReceive: boolean,
): boolean {
  if (isReceive) {
    // Receiving doesn't spend the account's balance.
    return true;
  }
  const balance = getAccountBalance(account);
  if (!balance) {
    return false;
  }
  return amount ? balance.greaterThanOrEqual(amount) : balance.isPositive();
}

/**
 * Compare two candidate accounts for recommendation priority (cheap-first, no cross-protocol
 * cost comparison): higher `purpose` priority first, then higher balance, then older account
 * (stable by `createdAt`). Returns a negative number when `a` should rank before `b`.
 */
function compareCandidates(a: Account, b: Account): number {
  const byPurpose = PURPOSE_PRIORITY[b.purpose] - PURPOSE_PRIORITY[a.purpose];
  if (byPurpose !== 0) {
    return byPurpose;
  }

  const balanceA = getAccountBalance(a);
  const balanceB = getAccountBalance(b);
  if (balanceA && balanceB && !balanceA.equals(balanceB)) {
    return balanceB.greaterThan(balanceA) ? 1 : -1;
  }

  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

/**
 * Recommend which of `accounts` to use for `intent`. PURE — no DB read, no live-wallet call.
 *
 * Pipeline:
 *  1. **Currency filter** — for a Lightning send, keep only BTC accounts (master parity).
 *  2. **Online filter** — keep only `isOnline` accounts (the offline ones can't transact;
 *     they are not surfaced as recommendations/alternatives).
 *  3. **Balance split** — partition the matching accounts into sufficient vs insufficient.
 *  4. **Rank** — order the sufficient accounts cheap-first (purpose priority → balance → age)
 *     and pick the top one as `recommended`, the rest as `alternatives`.
 *  5. **Default fallback** — if nothing has sufficient balance, fall back to the user's
 *     default account for the (filtered) currency when one is present in `accounts`, so the
 *     UI can still pre-select an account to top up; otherwise throw (no candidate at all).
 *
 * @param intent - what the user wants to do.
 * @param accounts - the accounts to choose from (the caller's cached set).
 * @param defaultAccountId - the user's default account id for the intent's currency, if known
 *   (used only for the fallback when no account has sufficient balance).
 * @returns the {@link AccountSuggestion}.
 * @throws Error if `accounts` is empty or no account matches the intent at all.
 */
export function suggestAccountFor(
  intent: PaymentIntent,
  accounts: Account[],
  defaultAccountId?: string,
): AccountSuggestion {
  if (accounts.length === 0) {
    throw new Error('No accounts to choose from');
  }

  const isReceive =
    intent.kind === 'receive' || intent.kind === 'token-receive';
  const destination = intent.kind === 'send' ? intent.destination : undefined;
  const currency = requiredCurrency(destination);
  const amount = intentAmount(intent);

  // 1 + 2: currency + online filter.
  const eligible = accounts.filter((account) => {
    if (currency && account.currency !== currency) {
      return false;
    }
    return account.isOnline;
  });

  // 3: split by sufficient balance.
  const sufficient: Account[] = [];
  const insufficient: Account[] = [];
  for (const account of eligible) {
    if (hasSufficientBalance(account, amount, isReceive)) {
      sufficient.push(account);
    } else {
      insufficient.push(account);
    }
  }

  // 4: rank the sufficient candidates cheap-first.
  if (sufficient.length > 0) {
    const ranked = [...sufficient].sort(compareCandidates);
    const [recommended, ...alternatives] = ranked;
    return {
      recommended,
      alternatives,
      insufficient,
      reason: reasonFor(recommended, isReceive),
    };
  }

  // 5: default fallback — nothing has sufficient balance. Prefer the user's default account
  // (for the eligible currency) so the UI can still pre-select; else the first insufficient.
  const fallback =
    (defaultAccountId && eligible.find((a) => a.id === defaultAccountId)) ||
    insufficient[0];

  if (!fallback) {
    throw new Error('No account matches the payment intent');
  }

  return {
    recommended: fallback,
    alternatives: [],
    insufficient: insufficient.filter((a) => a.id !== fallback.id),
    reason: isReceive
      ? 'default account'
      : 'insufficient balance; default account',
  };
}

/** Human-readable basis for a recommendation. */
function reasonFor(account: Account, isReceive: boolean): string {
  if (account.purpose === 'offer') {
    return 'offer-account match';
  }
  if (account.purpose === 'gift-card') {
    return 'gift-card-mint match';
  }
  const verb = isReceive ? 'receive to' : 'send from';
  return `${verb} ${account.type} account`;
}
