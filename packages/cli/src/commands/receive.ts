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

    const quoteResponse = await wallet.createMintQuoteBolt11(amount);

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
      const { MintQuoteState } = await import('@cashu/cashu-ts');
      const POLL_INTERVAL = 2000;
      const MAX_POLLS = 150;

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        const check = await wallet.checkMintQuoteBolt11(quoteResponse.quote);

        if (check.state === MintQuoteState.PAID) {
          const proofs = await wallet.mintTokens(amount, quoteResponse.quote);
          storeProofs(db, account.id, proofs.proofs);

          return {
            action: 'minted',
            minted: {
              amount: proofs.proofs.reduce(
                (sum: number, p: { amount: number }) => sum + p.amount,
                0,
              ),
              proof_count: proofs.proofs.length,
              account_id: account.id,
            },
          };
        }

        if (check.state === MintQuoteState.EXPIRED) {
          return {
            action: 'error',
            error: 'Mint quote expired before payment was received.',
            code: 'QUOTE_EXPIRED',
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

async function handleReceiveToken(
  token: string,
  args: ParsedArgs,
  db: Database,
): Promise<ReceiveResult> {
  try {
    const { getDecodedToken } = await import('@cashu/cashu-ts');
    const decoded = getDecodedToken(token);

    const mintUrl = decoded.mint;
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

    // Receive (swap) the token via the mint to get fresh proofs
    const { getCashuWallet } = await import('@agicash/sdk/lib/cashu/utils');
    const unit = account.currency === 'BTC' ? 'sat' : 'cent';
    const wallet = getCashuWallet(mintUrl, { unit });

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
