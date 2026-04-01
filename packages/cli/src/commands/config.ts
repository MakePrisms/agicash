import type { Database } from 'bun:sqlite';
import type { ParsedArgs } from '../args';

export interface ConfigResult {
  action: string;
  config?: Record<string, string>;
  error?: string;
  code?: string;
}

export function handleConfigCommand(
  args: ParsedArgs,
  db: Database,
): ConfigResult {
  const subcommand = args.positional[0];

  switch (subcommand) {
    case 'set':
      return handleConfigSet(args, db);
    case 'get':
      return handleConfigGet(args, db);
    case 'list':
    case undefined:
      return handleConfigList(db);
    default:
      return {
        action: 'error',
        error: `Unknown config subcommand: ${subcommand}. Use: config set <key> <value>, config get <key>, or config list`,
        code: 'UNKNOWN_SUBCOMMAND',
      };
  }
}

function handleConfigSet(args: ParsedArgs, db: Database): ConfigResult {
  const key = args.positional[1];
  const value = args.positional[2];

  if (!key || !value) {
    return {
      action: 'error',
      error: 'Usage: agicash config set <key> <value>',
      code: 'MISSING_ARGS',
    };
  }

  // Validate known keys
  const validKeys = ['default-btc-account', 'default-usd-account'];
  if (!validKeys.includes(key)) {
    return {
      action: 'error',
      error: `Unknown config key: ${key}. Valid keys: ${validKeys.join(', ')}`,
      code: 'UNKNOWN_KEY',
    };
  }

  db.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);

  return {
    action: 'set',
    config: { [key]: value },
  };
}

function handleConfigGet(args: ParsedArgs, db: Database): ConfigResult {
  const key = args.positional[1];
  if (!key) {
    return {
      action: 'error',
      error: 'Usage: agicash config get <key>',
      code: 'MISSING_KEY',
    };
  }

  const row = db.query('SELECT value FROM config WHERE key = ?').get(key) as {
    value: string;
  } | null;

  return {
    action: 'get',
    config: { [key]: row?.value ?? '' },
  };
}

function handleConfigList(db: Database): ConfigResult {
  const rows = db
    .query('SELECT key, value FROM config ORDER BY key')
    .all() as Array<{
    key: string;
    value: string;
  }>;

  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }

  return { action: 'list', config };
}

/** Get the default account ID for a currency, or null if not set */
export function getDefaultAccount(
  db: Database,
  currency: 'BTC' | 'USD',
): string | null {
  const key =
    currency === 'BTC' ? 'default-btc-account' : 'default-usd-account';
  const row = db.query('SELECT value FROM config WHERE key = ?').get(key) as {
    value: string;
  } | null;
  return row?.value ?? null;
}
