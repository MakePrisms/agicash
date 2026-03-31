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
  error?: string;
  code?: string;
}

export async function handleReceiveCommand(
  args: ParsedArgs,
  db: Database,
): Promise<ReceiveResult> {
  const amountStr = args.flags.amount as string;
  if (!amountStr) {
    return {
      action: 'error',
      error: 'Missing --amount flag. Usage: agicash receive --amount <sats>',
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

  // Find account — use --account flag or first cashu account
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
          "SELECT id, name, mint_url, currency FROM accounts WHERE type = 'cashu' ORDER BY created_at LIMIT 1",
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
        : 'No cashu accounts configured. Run: agicash mint add <url>',
      code: 'NO_ACCOUNT',
    };
  }

  // Create wallet and mint quote
  try {
    const { getCashuWallet } = await import(
      '@agicash/sdk/lib/cashu/utils'
    );
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

    // If --wait flag, poll for payment and mint tokens
    if (args.flags.wait) {
      const { MintQuoteState } = await import('@cashu/cashu-ts');
      const POLL_INTERVAL = 2000;
      const MAX_POLLS = 150; // 5 minutes

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        const check = await wallet.checkMintQuoteBolt11(quoteResponse.quote);

        if (check.state === MintQuoteState.PAID) {
          // Mint the tokens
          const proofs = await wallet.mintTokens(amount, quoteResponse.quote);

          // Store proofs in SQLite
          const insert = db.prepare(`
            INSERT INTO cashu_proofs (account_id, amount, secret, c, keyset_id, state)
            VALUES (?, ?, ?, ?, ?, 'UNSPENT')
          `);

          for (const proof of proofs.proofs) {
            insert.run(
              account.id,
              proof.amount,
              proof.secret,
              proof.C,
              proof.id,
            );
          }

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
