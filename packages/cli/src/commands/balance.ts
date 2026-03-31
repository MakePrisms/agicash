import type { Database } from 'bun:sqlite';

export interface AccountBalance {
  id: string;
  name: string;
  type: string;
  currency: string;
  mint_url: string | null;
  balance: number;
  proof_count: number;
}

export interface BalanceResult {
  accounts: AccountBalance[];
  totals: Record<string, number>;
}

export function handleBalanceCommand(db: Database): BalanceResult {
  const accounts = db
    .query(`
      SELECT
        a.id,
        a.name,
        a.type,
        a.currency,
        a.mint_url,
        COALESCE(SUM(p.amount), 0) as balance,
        COUNT(p.id) as proof_count
      FROM accounts a
      LEFT JOIN cashu_proofs p ON p.account_id = a.id AND p.state = 'UNSPENT'
      GROUP BY a.id
      ORDER BY a.currency, a.name
    `)
    .all() as Array<{
    id: string;
    name: string;
    type: string;
    currency: string;
    mint_url: string | null;
    balance: number;
    proof_count: number;
  }>;

  // Compute totals per currency
  const totals: Record<string, number> = {};
  for (const acct of accounts) {
    totals[acct.currency] = (totals[acct.currency] || 0) + acct.balance;
  }

  return { accounts, totals };
}
