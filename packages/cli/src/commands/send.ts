import type { Database } from 'bun:sqlite';
import type { ParsedArgs } from '../args';
import { withTransaction } from '../db';
import { createWalletWithCounters } from '../wallet-factory';

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

  if (!/^\d+$/.test(amountStr)) {
    return {
      action: 'error',
      error: `Invalid amount: ${amountStr}. Must be a positive integer (whole number of sats).`,
      code: 'INVALID_AMOUNT',
    };
  }
  const amount = Number.parseInt(amountStr, 10);
  if (amount <= 0) {
    return {
      action: 'error',
      error: `Invalid amount: ${amountStr}. Must be greater than zero.`,
      code: 'INVALID_AMOUNT',
    };
  }

  // Find account with sufficient balance
  type AccountRow = {
    id: string;
    name: string;
    mint_url: string;
    currency: string;
  };
  const accountId = args.flags.account as string | undefined;
  let account: AccountRow | null = null;

  if (accountId) {
    account = db
      .query(
        "SELECT id, name, mint_url, currency FROM accounts WHERE id = ? AND type = 'cashu'",
      )
      .get(accountId) as AccountRow | null;
  } else {
    // Try default accounts first
    for (const key of ['default-btc-account', 'default-usd-account']) {
      const cfg = db
        .query('SELECT value FROM config WHERE key = ?')
        .get(key) as { value: string } | null;
      if (cfg) {
        const candidate = db
          .query(
            `SELECT a.id, a.name, a.mint_url, a.currency
             FROM accounts a
             JOIN cashu_proofs p ON p.account_id = a.id AND p.state = 'UNSPENT'
             WHERE a.id = ? AND a.type = 'cashu'
             GROUP BY a.id
             HAVING SUM(p.amount) >= ?`,
          )
          .get(cfg.value, amount) as AccountRow | null;
        if (candidate) {
          account = candidate;
          break;
        }
      }
    }
    // Fall back to any account with sufficient balance
    if (!account) {
      account = db
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
        .get(amount) as AccountRow | null;
    }
  }

  if (!account) {
    return {
      action: 'error',
      error: accountId
        ? `Account not found: ${accountId}`
        : `No account with sufficient balance (need ${amount} sats).`,
      code: 'NO_ACCOUNT',
    };
  }

  // Get unspent proofs sorted ASC by amount for optimal selection
  const allProofs = db
    .query(
      `SELECT id, account_id, amount, secret, c, keyset_id
       FROM cashu_proofs
       WHERE account_id = ? AND state = 'UNSPENT'
       ORDER BY amount ASC`,
    )
    .all(account.id) as StoredProof[];

  // Select only enough proofs to cover the amount
  const selectedProofs: StoredProof[] = [];
  let selectedTotal = 0;
  for (const proof of allProofs) {
    selectedProofs.push(proof);
    selectedTotal += proof.amount;
    if (selectedTotal >= amount) break;
  }

  if (selectedTotal < amount) {
    return {
      action: 'error',
      error: `Insufficient balance. Need ${amount} but only have ${selectedTotal}.`,
      code: 'INSUFFICIENT_BALANCE',
    };
  }

  // Phase 1: Mark selected proofs as PENDING in a transaction
  withTransaction(db, () => {
    const markPending = db.prepare(
      "UPDATE cashu_proofs SET state = 'PENDING' WHERE id = ? AND state = 'UNSPENT'",
    );
    let count = 0;
    for (const proof of selectedProofs) {
      count += markPending.run(proof.id).changes;
    }
    if (count !== selectedProofs.length) {
      throw new Error(
        `Concurrency conflict: expected ${selectedProofs.length} proofs, but only ${count} were UNSPENT`,
      );
    }
  });

  // Phase 2: Network call — outside transaction
  const { getCashuProtocolUnit } = await import('@agicash/sdk/lib/cashu/utils');
  const { getEncodedToken } = await import('@cashu/cashu-ts');

  const wallet = await createWalletWithCounters(
    db,
    account.id,
    account.mint_url,
    account.currency,
  );
  await wallet.loadMint();

  const cashuProofs = selectedProofs.map((p) => ({
    amount: p.amount,
    secret: p.secret,
    C: p.c,
    id: p.keyset_id,
  }));

  let sendProofs: { amount: number; secret: string; C: string; id: string }[];
  let keepProofs: { amount: number; secret: string; C: string; id: string }[];

  try {
    const result = await wallet.send(amount, cashuProofs);
    sendProofs = result.send;
    keepProofs = result.keep;
  } catch (err) {
    // Phase-2 failure: mint didn't swap, safe to roll back PENDING → UNSPENT
    withTransaction(db, () => {
      const markUnspent = db.prepare(
        "UPDATE cashu_proofs SET state = 'UNSPENT' WHERE id = ?",
      );
      for (const proof of selectedProofs) {
        markUnspent.run(proof.id);
      }
    });

    return {
      action: 'error',
      error: `Failed to create ecash token: ${err instanceof Error ? err.message : String(err)}`,
      code: 'SEND_FAILED',
    };
  }

  const protocolUnit = getCashuProtocolUnit(account.currency as 'BTC' | 'USD');
  const encoded = getEncodedToken({
    mint: account.mint_url,
    proofs: sendProofs,
    unit: protocolUnit,
  });

  // Build a set of input secrets so we can distinguish returned-unchanged
  // proofs from newly-created change proofs.
  const inputSecrets = new Set(selectedProofs.map((p) => p.secret));

  // Phase 3: Mark originals SPENT + insert keep proofs in a transaction
  try {
    withTransaction(db, () => {
      const markSpent = db.prepare(
        "UPDATE cashu_proofs SET state = 'SPENT' WHERE id = ?",
      );
      for (const proof of selectedProofs) {
        markSpent.run(proof.id);
      }

      if (keepProofs.length > 0) {
        // wallet.send() returns keep proofs that may include:
        //  (a) original input proofs returned unchanged (not swapped)
        //  (b) new change proofs from the swap
        // For (a) we restore UNSPENT state; for (b) we INSERT new rows.
        const restoreUnspent = db.prepare(
          "UPDATE cashu_proofs SET state = 'UNSPENT' WHERE secret = ? AND state = 'SPENT'",
        );
        const insertProof = db.prepare(`
          INSERT INTO cashu_proofs (account_id, amount, secret, c, keyset_id, state)
          VALUES (?, ?, ?, ?, ?, 'UNSPENT')
        `);
        for (const proof of keepProofs) {
          if (inputSecrets.has(proof.secret)) {
            // Original proof returned unchanged — restore it
            restoreUnspent.run(proof.secret);
          } else {
            // New change proof from swap
            insertProof.run(
              account.id,
              proof.amount,
              proof.secret,
              proof.C,
              proof.id,
            );
          }
        }
      }
    });
  } catch (dbErr) {
    // Phase-3 failure: proofs are already spent at the mint — DO NOT roll back.
    // Encode keepProofs so the user can recover change manually.
    const keepEncoded =
      keepProofs.length > 0
        ? getEncodedToken({
            mint: account.mint_url,
            proofs: keepProofs,
            unit: protocolUnit,
          })
        : null;
    console.error(
      JSON.stringify({
        critical: 'DB_WRITE_FAILED_AFTER_SWAP',
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        send_token: encoded,
        keep_token: keepEncoded,
        account_id: account.id,
        mint_url: account.mint_url,
      }),
    );
    process.exit(2);
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
}
