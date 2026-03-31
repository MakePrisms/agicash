import type { Database } from 'bun:sqlite';
import type { ParsedArgs } from '../args';

export interface PayResult {
  action: string;
  payment?: {
    bolt11: string;
    amount: number;
    fee: number;
    total: number;
    currency: string;
    account_id: string;
    account_name: string;
    mint_url: string;
    proofs_spent: number;
    change_proofs: number;
  };
  error?: string;
  code?: string;
}

interface StoredProof {
  id: string;
  account_id: string;
  amount: number;
  secret: string;
  c: string;
  keyset_id: string;
}

export async function handlePayCommand(
  args: ParsedArgs,
  db: Database,
): Promise<PayResult> {
  const bolt11 = (args.flags.bolt11 as string) || args.positional[0];
  if (!bolt11) {
    return {
      action: 'error',
      error:
        'Missing invoice. Usage: agicash pay --bolt11 <invoice> or agicash pay <invoice>',
      code: 'MISSING_INVOICE',
    };
  }

  if (!bolt11.startsWith('ln')) {
    return {
      action: 'error',
      error: 'Invalid Lightning invoice. Must start with "ln".',
      code: 'INVALID_INVOICE',
    };
  }

  // Find account — use --account flag or first cashu account with balance
  const accountId = args.flags.account as string | undefined;

  const account = accountId
    ? (db
        .query(
          "SELECT id, name, mint_url, currency FROM accounts WHERE id = ? AND type = 'cashu'",
        )
        .get(accountId) as {
        id: string;
        name: string;
        mint_url: string;
        currency: string;
      } | null)
    : (db
        .query(
          `SELECT a.id, a.name, a.mint_url, a.currency
           FROM accounts a
           JOIN cashu_proofs p ON p.account_id = a.id AND p.state = 'UNSPENT'
           WHERE a.type = 'cashu'
           GROUP BY a.id
           HAVING SUM(p.amount) > 0
           ORDER BY SUM(p.amount) DESC
           LIMIT 1`,
        )
        .get() as {
        id: string;
        name: string;
        mint_url: string;
        currency: string;
      } | null);

  if (!account) {
    return {
      action: 'error',
      error: accountId
        ? `Account not found: ${accountId}`
        : 'No accounts with balance. Receive some ecash first.',
      code: 'NO_ACCOUNT',
    };
  }

  // Get unspent proofs for this account
  const proofs = db
    .query(
      `SELECT id, account_id, amount, secret, c, keyset_id
       FROM cashu_proofs
       WHERE account_id = ? AND state = 'UNSPENT'
       ORDER BY amount DESC`,
    )
    .all(account.id) as StoredProof[];

  if (proofs.length === 0) {
    return {
      action: 'error',
      error: 'No unspent proofs in this account.',
      code: 'NO_BALANCE',
    };
  }

  try {
    const { getCashuWallet } = await import('@agicash/sdk/lib/cashu/utils');
    const unit = account.currency === 'BTC' ? 'sat' : 'cent';
    const wallet = getCashuWallet(account.mint_url, { unit });
    await wallet.loadMint();

    // Get melt quote to determine fee
    const meltQuote = await wallet.createMeltQuoteBolt11(bolt11);
    const totalNeeded = meltQuote.amount + meltQuote.fee_reserve;

    // Select proofs to cover amount + fee
    const selectedProofs: StoredProof[] = [];
    let selectedTotal = 0;

    for (const proof of proofs) {
      selectedProofs.push(proof);
      selectedTotal += proof.amount;
      if (selectedTotal >= totalNeeded) break;
    }

    if (selectedTotal < totalNeeded) {
      const available = proofs.reduce((sum, p) => sum + p.amount, 0);
      return {
        action: 'error',
        error: `Insufficient balance. Need ${totalNeeded} (${meltQuote.amount} + ${meltQuote.fee_reserve} fee) but only have ${available}.`,
        code: 'INSUFFICIENT_BALANCE',
      };
    }

    // Convert to cashu-ts Proof format
    const cashuProofs = selectedProofs.map((p) => ({
      amount: p.amount,
      secret: p.secret,
      C: p.c,
      id: p.keyset_id,
    }));

    // Execute melt
    const meltResult = await wallet.meltProofsBolt11(meltQuote, cashuProofs);

    // Mark spent proofs in SQLite
    const markSpent = db.prepare(
      "UPDATE cashu_proofs SET state = 'SPENT' WHERE id = ?",
    );
    for (const proof of selectedProofs) {
      markSpent.run(proof.id);
    }

    // Store any change proofs
    let changeCount = 0;
    if (meltResult.change && meltResult.change.length > 0) {
      const insertProof = db.prepare(`
        INSERT INTO cashu_proofs (account_id, amount, secret, c, keyset_id, state)
        VALUES (?, ?, ?, ?, ?, 'UNSPENT')
      `);
      for (const changeProof of meltResult.change) {
        insertProof.run(
          account.id,
          changeProof.amount,
          changeProof.secret,
          changeProof.C,
          changeProof.id,
        );
        changeCount++;
      }
    }

    return {
      action: 'paid',
      payment: {
        bolt11,
        amount: meltQuote.amount,
        fee: meltQuote.fee_reserve,
        total: selectedTotal,
        currency: account.currency,
        account_id: account.id,
        account_name: account.name,
        mint_url: account.mint_url,
        proofs_spent: selectedProofs.length,
        change_proofs: changeCount,
      },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Send failed: ${err instanceof Error ? err.message : String(err)}`,
      code: 'SEND_FAILED',
    };
  }
}
