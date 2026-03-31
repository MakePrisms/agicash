import type { Database } from 'bun:sqlite';
import type { ParsedArgs } from '../args';

export interface MintCommandResult {
  action: string;
  account?: {
    id: string;
    name: string;
    type: string;
    currency: string;
    mint_url: string;
    is_test_mint: boolean;
    created_at: string;
  };
  accounts?: Array<{
    id: string;
    name: string;
    type: string;
    currency: string;
    mint_url: string;
    is_test_mint: boolean;
    created_at: string;
  }>;
  error?: string;
  code?: string;
}

export async function handleMintCommand(
  args: ParsedArgs,
  db: Database,
): Promise<MintCommandResult> {
  const subcommand = args.positional[0];

  switch (subcommand) {
    case 'add':
      return handleMintAdd(args, db);
    case 'list':
      return handleMintList(db);
    default:
      return {
        action: 'error',
        error: `Unknown mint subcommand: ${subcommand ?? '(none)'}. Use: mint add <url> or mint list`,
        code: 'UNKNOWN_SUBCOMMAND',
      };
  }
}

async function handleMintAdd(
  args: ParsedArgs,
  db: Database,
): Promise<MintCommandResult> {
  const mintUrl = args.positional[1];
  if (!mintUrl) {
    return {
      action: 'error',
      error: 'Missing mint URL. Usage: agicash mint add <url>',
      code: 'MISSING_URL',
    };
  }

  // Normalize URL
  const normalizedUrl = mintUrl.replace(/\/+$/, '');

  // Validate URL format
  try {
    new URL(normalizedUrl);
  } catch {
    return {
      action: 'error',
      error: `Invalid URL: ${mintUrl}`,
      code: 'INVALID_URL',
    };
  }

  // Check for duplicate
  const existing = db
    .query('SELECT id FROM accounts WHERE mint_url = ? AND type = ?')
    .get(normalizedUrl, 'cashu') as { id: string } | null;

  if (existing) {
    return {
      action: 'error',
      error: `Mint already added: ${normalizedUrl}`,
      code: 'DUPLICATE_MINT',
    };
  }

  // Determine currency from flags (default BTC)
  const currency = (args.flags.currency as string)?.toUpperCase() || 'BTC';
  if (currency !== 'BTC' && currency !== 'USD') {
    return {
      action: 'error',
      error: `Invalid currency: ${currency}. Must be BTC or USD.`,
      code: 'INVALID_CURRENCY',
    };
  }

  // Determine name from flags or generate
  const name =
    (args.flags.name as string) || `${currency} Mint`;

  // Check if test mint
  let isTestMint = false;
  try {
    const { checkIsTestMint } = await import(
      '@agicash/sdk/lib/cashu/utils'
    );
    isTestMint = await checkIsTestMint(normalizedUrl);
  } catch {
    // If we can't check, assume mainnet
    isTestMint = false;
  }

  // Insert account
  const stmt = db.prepare(`
    INSERT INTO accounts (name, type, currency, purpose, mint_url, is_test_mint, keyset_counters)
    VALUES (?, 'cashu', ?, 'transactional', ?, ?, '{}')
    RETURNING *
  `);

  const row = stmt.get(name, currency, normalizedUrl, isTestMint ? 1 : 0) as {
    id: string;
    name: string;
    type: string;
    currency: string;
    mint_url: string;
    is_test_mint: number;
    created_at: string;
  };

  return {
    action: 'added',
    account: {
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      mint_url: row.mint_url,
      is_test_mint: Boolean(row.is_test_mint),
      created_at: row.created_at,
    },
  };
}

function handleMintList(db: Database): MintCommandResult {
  const rows = db
    .query(
      "SELECT id, name, type, currency, mint_url, is_test_mint, created_at FROM accounts WHERE type = 'cashu' ORDER BY created_at",
    )
    .all() as Array<{
    id: string;
    name: string;
    type: string;
    currency: string;
    mint_url: string;
    is_test_mint: number;
    created_at: string;
  }>;

  return {
    action: 'list',
    accounts: rows.map((r) => ({
      ...r,
      is_test_mint: Boolean(r.is_test_mint),
    })),
  };
}
