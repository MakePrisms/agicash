import type { Database } from 'bun:sqlite';

/**
 * Reads keyset counters from the accounts table.
 * Returns a Record<keysetId, nextCounter>.
 */
export function loadCounters(
  db: Database,
  accountId: string,
): Record<string, number> {
  const row = db
    .query('SELECT keyset_counters FROM accounts WHERE id = ?')
    .get(accountId) as { keyset_counters: string } | null;

  if (!row?.keyset_counters) return {};

  try {
    return JSON.parse(row.keyset_counters);
  } catch {
    return {};
  }
}

/**
 * Saves keyset counters to the accounts table.
 * Merges with existing counters, only advancing (never going backward).
 */
export function saveCounters(
  db: Database,
  accountId: string,
  counters: Record<string, number>,
): void {
  const existing = loadCounters(db, accountId);

  // Merge: take the max of existing and new for each keyset
  for (const [keysetId, next] of Object.entries(counters)) {
    existing[keysetId] = Math.max(existing[keysetId] ?? 0, next);
  }

  db.prepare('UPDATE accounts SET keyset_counters = ? WHERE id = ?').run(
    JSON.stringify(existing),
    accountId,
  );
}

/**
 * Updates a single keyset counter after an operation.
 * Only advances the counter (never goes backward).
 */
export function advanceCounter(
  db: Database,
  accountId: string,
  keysetId: string,
  next: number,
): void {
  saveCounters(db, accountId, { [keysetId]: next });
}
