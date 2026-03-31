import type { Database } from 'bun:sqlite';
import type { ParsedArgs } from '../args';

export interface QuotesResult {
  action: string;
  quotes?: Array<{
    id: string;
    type: string;
    account_id: string;
    amount: number;
    bolt11: string | null;
    state: string;
    created_at: string;
    age_seconds: number;
  }>;
  checked?: {
    total: number;
    completed: number;
    still_pending: number;
    errors: number;
    details: Array<{
      id: string;
      status: string;
      amount?: number;
      proof_count?: number;
      error?: string;
    }>;
  };
  error?: string;
  code?: string;
}

interface QuoteRow {
  id: string;
  type: string;
  account_id: string;
  amount: number;
  bolt11: string | null;
  state: string;
  created_at: string;
}

interface AccountRow {
  id: string;
  name: string;
  mint_url: string;
  currency: string;
}

export async function handleQuotesCommand(
  args: ParsedArgs,
  db: Database,
): Promise<QuotesResult> {
  const subcommand = args.positional[0];

  switch (subcommand) {
    case 'list':
      return handleQuotesList(db);
    case 'check':
      return handleQuotesCheck(db);
    default:
      return {
        action: 'error',
        error: 'Usage: agicash quotes list | agicash quotes check',
        code: 'MISSING_SUBCOMMAND',
      };
  }
}

function handleQuotesList(db: Database): QuotesResult {
  const rows = db
    .query(
      `SELECT id, type, account_id, amount, bolt11, state, created_at
       FROM quotes
       WHERE state = 'PENDING'
       ORDER BY created_at DESC`,
    )
    .all() as QuoteRow[];

  const now = Date.now();
  const quotes = rows.map((row) => ({
    id: row.id,
    type: row.type,
    account_id: row.account_id,
    amount: row.amount,
    bolt11: row.bolt11,
    state: row.state,
    created_at: row.created_at,
    age_seconds: Math.floor(
      (now - new Date(`${row.created_at}Z`).getTime()) / 1000,
    ),
  }));

  return { action: 'list', quotes };
}

async function handleQuotesCheck(db: Database): Promise<QuotesResult> {
  const rows = db
    .query(
      `SELECT id, type, account_id, amount, bolt11, state, created_at
       FROM quotes
       WHERE state = 'PENDING' AND type = 'mint'
       ORDER BY created_at ASC`,
    )
    .all() as QuoteRow[];

  let completed = 0;
  let stillPending = 0;
  let errors = 0;
  const details: Array<{
    id: string;
    status: string;
    amount?: number;
    proof_count?: number;
    error?: string;
  }> = [];

  for (const row of rows) {
    const account = db
      .query(
        "SELECT id, name, mint_url, currency FROM accounts WHERE id = ? AND type = 'cashu'",
      )
      .get(row.account_id) as AccountRow | null;

    if (!account) {
      errors++;
      details.push({
        id: row.id,
        status: 'error',
        error: `Account not found: ${row.account_id}`,
      });
      continue;
    }

    try {
      const { getCashuWallet } = await import('@agicash/sdk/lib/cashu/utils');
      const { MintQuoteState } = await import('@cashu/cashu-ts');
      const unit = account.currency === 'BTC' ? 'sat' : 'cent';
      const wallet = getCashuWallet(account.mint_url, { unit });
      await wallet.loadMint();

      const check = await wallet.checkMintQuoteBolt11(row.id);

      if (check.state === MintQuoteState.PAID) {
        const proofs = await wallet.mintProofsBolt11(row.amount, row.id);

        // Store proofs
        const insert = db.prepare(`
          INSERT INTO cashu_proofs (account_id, amount, secret, c, keyset_id, state)
          VALUES (?, ?, ?, ?, ?, 'UNSPENT')
        `);
        for (const proof of proofs) {
          insert.run(account.id, proof.amount, proof.secret, proof.C, proof.id);
        }

        // Mark quote completed
        db.prepare("UPDATE quotes SET state = 'COMPLETED' WHERE id = ?").run(
          row.id,
        );

        const totalMinted = proofs.reduce(
          (sum: number, p: { amount: number }) => sum + p.amount,
          0,
        );
        completed++;
        details.push({
          id: row.id,
          status: 'completed',
          amount: totalMinted,
          proof_count: proofs.length,
        });
      } else {
        stillPending++;
        details.push({ id: row.id, status: 'pending' });
      }
    } catch (err) {
      errors++;
      details.push({
        id: row.id,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    action: 'checked',
    checked: {
      total: rows.length,
      completed,
      still_pending: stillPending,
      errors,
      details,
    },
  };
}
