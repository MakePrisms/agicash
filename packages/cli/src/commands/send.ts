import type { Database } from 'bun:sqlite';
import type { ParsedArgs } from '../args';

export interface SendResult {
  action: string;
  token?: {
    encoded: string;
    amount: number;
    mint_url: string;
    account_id: string;
    proof_count: number;
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

export async function handleSendCommand(
  args: ParsedArgs,
  db: Database,
): Promise<SendResult> {
  const amountStr = args.positional[0] || (args.flags.amount as string);
  if (!amountStr) {
    return {
      action: 'error',
      error:
        'Usage: agicash send <amount> — creates a cashu token for the given amount in sats',
      code: 'MISSING_AMOUNT',
    };
  }

  const amount = Number.parseInt(amountStr, 10);
  if (Number.isNaN(amount) || amount <= 0) {
    return {
      action: 'error',
      error: `Invalid amount: ${amountStr}. Must be a positive integer.`,
      code: 'INVALID_AMOUNT',
    };
  }

  // Find account with sufficient balance
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
           HAVING SUM(p.amount) >= ?
           ORDER BY SUM(p.amount) ASC
           LIMIT 1`,
        )
        .get(amount) as {
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
        : `No account with sufficient balance (need ${amount} sats).`,
      code: 'NO_ACCOUNT',
    };
  }

  // Get unspent proofs
  const proofs = db
    .query(
      `SELECT id, account_id, amount, secret, c, keyset_id
       FROM cashu_proofs
       WHERE account_id = ? AND state = 'UNSPENT'
       ORDER BY amount ASC`,
    )
    .all(account.id) as StoredProof[];

  const totalAvailable = proofs.reduce((sum, p) => sum + p.amount, 0);
  if (totalAvailable < amount) {
    return {
      action: 'error',
      error: `Insufficient balance. Need ${amount} but only have ${totalAvailable}.`,
      code: 'INSUFFICIENT_BALANCE',
    };
  }

  try {
    const { getCashuWallet } = await import('@agicash/sdk/lib/cashu/utils');
    const { getEncodedToken } = await import('@cashu/cashu-ts');

    const unit = account.currency === 'BTC' ? 'sat' : 'cent';
    const wallet = getCashuWallet(account.mint_url, { unit });

    // Convert stored proofs to cashu-ts format
    const cashuProofs = proofs.map((p) => ({
      amount: p.amount,
      secret: p.secret,
      C: p.c,
      id: p.keyset_id,
    }));

    // Use wallet.send to get exact amount proofs (handles splitting)
    const { send: sendProofs, keep: keepProofs } = await wallet.send(
      amount,
      cashuProofs,
    );

    // Encode the send proofs as a cashu token
    const encoded = getEncodedToken({
      mint: account.mint_url,
      proofs: sendProofs,
      unit,
    });

    // Mark all original proofs as spent (they were all consumed by the swap)
    const markSpent = db.prepare(
      "UPDATE cashu_proofs SET state = 'SPENT' WHERE id = ?",
    );
    for (const proof of proofs) {
      markSpent.run(proof.id);
    }

    // Store keep (change) proofs
    if (keepProofs.length > 0) {
      const insertProof = db.prepare(`
        INSERT INTO cashu_proofs (account_id, amount, secret, c, keyset_id, state)
        VALUES (?, ?, ?, ?, ?, 'UNSPENT')
      `);
      for (const proof of keepProofs) {
        insertProof.run(
          account.id,
          proof.amount,
          proof.secret,
          proof.C,
          proof.id,
        );
      }
    }

    return {
      action: 'created',
      token: {
        encoded,
        amount: sendProofs.reduce(
          (sum: number, p: { amount: number }) => sum + p.amount,
          0,
        ),
        mint_url: account.mint_url,
        account_id: account.id,
        proof_count: sendProofs.length,
      },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to create ecash token: ${err instanceof Error ? err.message : String(err)}`,
      code: 'SEND_FAILED',
    };
  }
}
