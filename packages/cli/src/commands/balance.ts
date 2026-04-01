import { getAccountBalance } from '@agicash/sdk/features/accounts/account';
import { getCashuUnit } from '@agicash/sdk/lib/cashu/utils';
import type { SdkContext } from '../sdk-context';

export interface AccountBalance {
  id: string;
  name: string;
  type: string;
  currency: string;
  mintUrl: string | null;
  balance: number;
  proofCount: number;
}

export interface BalanceResult {
  accounts: AccountBalance[];
  totals: Record<string, number>;
}

export async function handleBalanceCommand(
  ctx: SdkContext,
): Promise<BalanceResult> {
  const accounts = await ctx.accountRepo.getAll(ctx.userId);

  const balanceAccounts: AccountBalance[] = accounts.map((account) => {
    const balance = getAccountBalance(account);
    // Use cashu unit (sat/cent) for consistent CLI output
    const unit = getCashuUnit(account.currency);
    const balanceNumber = balance?.toNumber(unit) ?? 0;

    return {
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      mintUrl: account.type === 'cashu' ? account.mintUrl : null,
      balance: balanceNumber,
      proofCount: account.type === 'cashu' ? account.proofs.length : 0,
    };
  });

  // Compute totals per currency
  const totals: Record<string, number> = {};
  for (const acct of balanceAccounts) {
    totals[acct.currency] = (totals[acct.currency] || 0) + acct.balance;
  }

  return { accounts: balanceAccounts, totals };
}
