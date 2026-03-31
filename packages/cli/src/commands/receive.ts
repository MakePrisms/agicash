import type { Database } from 'bun:sqlite';
import type { ParsedArgs } from '../args';

export interface ReceiveResult {
  action: string;
  quote?: {
    id: string;
    bolt11: string;
    amount: number;
    currency: string;
    account_id: string;
    account_name: string;
    mint_url: string;
    state: string;
    expiry?: number;
  };
  minted?: {
    amount: number;
    proof_count: number;
    account_id: string;
  };
  claimed?: {
    amount: number;
    proof_count: number;
    account_id: string;
    mint_url: string;
  };
  error?: string;
  code?: string;
}

export async function handleReceiveCommand(
  args: ParsedArgs,
  db: Database,
): Promise<ReceiveResult> {
  // Check/resume a previous quote
  const checkQuoteId = args.flags.check as string;
  if (checkQuoteId) {
    return handleCheckQuote(checkQuoteId, args, db);
  }

  const input = args.positional[0] || (args.flags.amount as string);

  if (!input) {
    return {
      action: 'error',
      error:
        'Usage: agicash receive <amount> (Lightning) or agicash receive <cashu-token>',
      code: 'MISSING_INPUT',
    };
  }

  // Detect intent: cashu token or amount
  if (input.startsWith('cashuA') || input.startsWith('cashuB')) {
    return handleReceiveToken(input, args, db);
  }

  // Treat as amount (Lightning receive)
  const amount = Number.parseInt(input, 10);
  if (Number.isNaN(amount) || amount <= 0) {
    return {
      action: 'error',
      error: `Invalid input: ${input}. Provide an amount in sats or a cashu token.`,
      code: 'INVALID_INPUT',
    };
  }

  return handleReceiveLightning(amount, args, db);
}

async function handleReceiveLightning(
  amount: number,
  args: ParsedArgs,
  db: Database,
): Promise<ReceiveResult> {
  const accountId = args.flags.account as string | undefined;
  const account = findAccount(db, accountId);

  if (!account) {
    return {
      action: 'error',
      error: accountId
        ? `Account not found: ${accountId}`
        : 'No cashu accounts configured. Run: agicash mint add <url>',
      code: 'NO_ACCOUNT',
    };
  }

  try {
    const { getCashuWallet } = await import('@agicash/sdk/lib/cashu/utils');
    const unit = account.currency === 'BTC' ? 'sat' : 'cent';
    const wallet = getCashuWallet(account.mint_url, { unit });
    await wallet.loadMint();

    const quoteResponse = await wallet.createMintQuoteBolt11(amount);

    // Save quote to DB for tracking
    db.prepare(
      `INSERT INTO quotes (id, type, account_id, amount, bolt11, state)
       VALUES (?, 'mint', ?, ?, ?, 'PENDING')`,
    ).run(quoteResponse.quote, account.id, amount, quoteResponse.request);

    const result: ReceiveResult = {
      action: 'invoice',
      quote: {
        id: quoteResponse.quote,
        bolt11: quoteResponse.request,
        amount,
        currency: account.currency,
        account_id: account.id,
        account_name: account.name,
        mint_url: account.mint_url,
        state: String(quoteResponse.state),
        expiry: quoteResponse.expiry,
      },
    };

    if (args.flags.wait) {
      // Print the invoice immediately so the user can pay it while we poll
      console.log(JSON.stringify(result));

      const { MintQuoteState } = await import('@cashu/cashu-ts');
      const POLL_INTERVAL = 2000;
      const MAX_POLLS = 150;

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        const check = await wallet.checkMintQuoteBolt11(quoteResponse.quote);

        if (check.state === MintQuoteState.PAID) {
          const proofs = await wallet.mintProofsBolt11(
            amount,
            quoteResponse.quote,
          );
          storeProofs(db, account.id, proofs);
          db.prepare("UPDATE quotes SET state = 'COMPLETED' WHERE id = ?").run(
            quoteResponse.quote,
          );

          return {
            action: 'minted',
            minted: {
              amount: proofs.reduce(
                (sum: number, p: { amount: number }) => sum + p.amount,
                0,
              ),
              proof_count: proofs.length,
              account_id: account.id,
            },
          };
        }

        if (check.state !== MintQuoteState.UNPAID) {
          return {
            action: 'error',
            error: `Unexpected quote state: ${String(check.state)}`,
            code: 'UNEXPECTED_STATE',
          };
        }
      }

      return {
        action: 'error',
        error: 'Timed out waiting for payment (5 minutes).',
        code: 'TIMEOUT',
      };
    }

    return result;
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to create mint quote: ${err instanceof Error ? err.message : String(err)}`,
      code: 'MINT_QUOTE_FAILED',
    };
  }
}

async function handleCheckQuote(
  quoteId: string,
  args: ParsedArgs,
  db: Database,
): Promise<ReceiveResult> {
  // Need an account to know which mint to check against
  const accountId = args.flags.account as string | undefined;
  const account = findAccount(db, accountId);

  if (!account) {
    return {
      action: 'error',
      error: accountId
        ? `Account not found: ${accountId}`
        : 'No cashu accounts configured. Run: agicash mint add <url>',
      code: 'NO_ACCOUNT',
    };
  }

  try {
    const { getCashuWallet } = await import('@agicash/sdk/lib/cashu/utils');
    const { MintQuoteState } = await import('@cashu/cashu-ts');
    const unit = account.currency === 'BTC' ? 'sat' : 'cent';
    const wallet = getCashuWallet(account.mint_url, { unit });
    await wallet.loadMint();

    const check = await wallet.checkMintQuoteBolt11(quoteId);

    if (check.state === MintQuoteState.PAID) {
      const proofs = await wallet.mintProofsBolt11(check.amount, quoteId);
      storeProofs(db, account.id, proofs);
      db.prepare("UPDATE quotes SET state = 'COMPLETED' WHERE id = ?").run(
        quoteId,
      );

      return {
        action: 'minted',
        minted: {
          amount: proofs.reduce(
            (sum: number, p: { amount: number }) => sum + p.amount,
            0,
          ),
          proof_count: proofs.length,
          account_id: account.id,
        },
      };
    }

    return {
      action: 'pending',
      quote: {
        id: quoteId,
        bolt11: check.request,
        amount: check.amount,
        currency: account.currency,
        account_id: account.id,
        account_name: account.name,
        mint_url: account.mint_url,
        state: String(check.state),
        expiry: check.expiry,
      },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to check quote: ${err instanceof Error ? err.message : String(err)}`,
      code: 'CHECK_FAILED',
    };
  }
}

async function handleReceiveToken(
  token: string,
  args: ParsedArgs,
  db: Database,
): Promise<ReceiveResult> {
  try {
    // Use getTokenMetadata to extract mint URL without needing keyset IDs.
    // getDecodedToken fails on v4 (cashuB) tokens with short keyset IDs
    // unless the mint's full keyset list is provided upfront.
    const { getTokenMetadata } = await import('@cashu/cashu-ts');
    const tokenMeta = getTokenMetadata(token);

    const mintUrl = tokenMeta.mint;
    if (!mintUrl) {
      return {
        action: 'error',
        error: 'Cashu token does not specify a mint URL.',
        code: 'NO_MINT_IN_TOKEN',
      };
    }

    // Find or auto-select account for this mint
    const accountId = args.flags.account as string | undefined;
    const account = accountId
      ? findAccountById(db, accountId)
      : findAccountByMint(db, mintUrl);

    if (!account) {
      return {
        action: 'error',
        error: `No account for mint ${mintUrl}. Run: agicash mint add ${mintUrl}`,
        code: 'NO_ACCOUNT_FOR_MINT',
      };
    }

    // Use getCashuWallet (which handles unit mapping) and loadMint to
    // populate the keychain with all keyset IDs. wallet.receive() internally
    // calls decodeToken with those IDs, resolving short v2 keyset IDs.
    const { getCashuWallet } = await import('@agicash/sdk/lib/cashu/utils');
    const unit = account.currency === 'BTC' ? 'sat' : 'cent';
    const wallet = getCashuWallet(mintUrl, { unit });
    await wallet.loadMint();

    const receivedProofs = await wallet.receive(token);

    // Store new proofs
    storeProofs(db, account.id, receivedProofs);

    const totalAmount = receivedProofs.reduce(
      (sum: number, p: { amount: number }) => sum + p.amount,
      0,
    );

    return {
      action: 'claimed',
      claimed: {
        amount: totalAmount,
        proof_count: receivedProofs.length,
        account_id: account.id,
        mint_url: mintUrl,
      },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to receive token: ${err instanceof Error ? err.message : String(err)}`,
      code: 'RECEIVE_TOKEN_FAILED',
    };
  }
}

// Shared helpers

interface AccountRow {
  id: string;
  name: string;
  mint_url: string;
  currency: string;
}

function findAccount(db: Database, accountId?: string): AccountRow | null {
  if (accountId) return findAccountById(db, accountId);

  // Check for default BTC account, then USD
  for (const key of ['default-btc-account', 'default-usd-account']) {
    const row = db.query('SELECT value FROM config WHERE key = ?').get(key) as {
      value: string;
    } | null;
    if (row) {
      const account = findAccountById(db, row.value);
      if (account) return account;
    }
  }

  // Fall back to first account
  return db
    .query(
      "SELECT id, name, mint_url, currency FROM accounts WHERE type = 'cashu' ORDER BY created_at LIMIT 1",
    )
    .get() as AccountRow | null;
}

function findAccountById(db: Database, id: string): AccountRow | null {
  return db
    .query(
      "SELECT id, name, mint_url, currency FROM accounts WHERE id = ? AND type = 'cashu'",
    )
    .get(id) as AccountRow | null;
}

function findAccountByMint(db: Database, mintUrl: string): AccountRow | null {
  return db
    .query(
      "SELECT id, name, mint_url, currency FROM accounts WHERE mint_url = ? AND type = 'cashu' LIMIT 1",
    )
    .get(mintUrl) as AccountRow | null;
}

function storeProofs(
  db: Database,
  accountId: string,
  proofs: Array<{ amount: number; secret: string; C: string; id: string }>,
): void {
  const insert = db.prepare(`
    INSERT INTO cashu_proofs (account_id, amount, secret, c, keyset_id, state)
    VALUES (?, ?, ?, ?, ?, 'UNSPENT')
  `);
  for (const proof of proofs) {
    insert.run(accountId, proof.amount, proof.secret, proof.C, proof.id);
  }
}
