import type {
  Account,
  AccountType,
  ExtendedAccount,
} from '@agicash/sdk/features/accounts/account';
import {
  canReceiveFromLightning,
  canSendToLightning,
} from '@agicash/sdk/features/accounts/account';
import { AccountService } from '@agicash/sdk/features/accounts/account-service';
import type { Currency } from '@agicash/sdk/lib/money/index';
import type { SdkContext } from './sdk-context';

export type ResolveAccountOpts = {
  accountId?: string;
  currency?: Currency;
  preferType?: AccountType;
  requireCanSendLightning?: boolean;
  requireCanReceiveLightning?: boolean;
};

/**
 * Shared account resolution used by all commands.
 *
 * Resolution order:
 * 1. If `accountId` provided, fetch that account directly.
 * 2. Fetch User from Supabase to determine defaults.
 * 3. Fetch all accounts and build extended accounts (with isDefault flag).
 * 4. Filter by currency, preferType, and lightning capability.
 * 5. Return the first default account in the filtered set, or the first available, or null.
 */
export async function resolveAccount(
  ctx: SdkContext,
  opts: ResolveAccountOpts = {},
): Promise<Account | null> {
  // Explicit --account flag takes priority
  if (opts.accountId) {
    try {
      return await ctx.accountRepo.get(opts.accountId);
    } catch {
      return null;
    }
  }

  // Fetch user + accounts for default resolution
  const user = await ctx.wallet.queryClient.fetchQuery(
    ctx.wallet.queries.userQuery(),
  );
  const accounts = await ctx.accountRepo.getAll(ctx.userId);
  const extended: ExtendedAccount[] = AccountService.getExtendedAccounts(
    user,
    accounts,
  );

  let candidates: ExtendedAccount[] = extended;

  if (opts.currency) {
    candidates = candidates.filter((a) => a.currency === opts.currency);
  }

  if (opts.preferType) {
    const typed = candidates.filter((a) => a.type === opts.preferType);
    if (typed.length > 0) candidates = typed;
  }

  if (opts.requireCanSendLightning) {
    candidates = candidates.filter((a) => canSendToLightning(a));
  }

  if (opts.requireCanReceiveLightning) {
    candidates = candidates.filter((a) => canReceiveFromLightning(a));
  }

  // Prefer default, fall back to first
  return candidates.find((a) => a.isDefault) ?? candidates[0] ?? null;
}
