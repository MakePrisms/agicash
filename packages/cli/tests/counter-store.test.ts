import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  advanceCounter,
  loadCounters,
  saveCounters,
} from '../src/counter-store';
import { getTestDb } from '../src/db';

function addAccount(db: Database): string {
  const row = db
    .prepare(
      `INSERT INTO accounts (name, type, currency, mint_url) VALUES ('Test', 'cashu', 'BTC', 'https://testnut.cashu.space') RETURNING id`,
    )
    .get() as { id: string };
  return row.id;
}

describe('counter-store', () => {
  let db: Database;
  let accountId: string;

  beforeEach(() => {
    db = getTestDb();
    accountId = addAccount(db);
  });

  test('loadCounters returns empty object for fresh account', () => {
    const counters = loadCounters(db, accountId);
    expect(counters).toEqual({});
  });

  test('saveCounters persists and loadCounters reads back', () => {
    saveCounters(db, accountId, { '00abc123': 5, '00def456': 10 });
    const counters = loadCounters(db, accountId);
    expect(counters).toEqual({ '00abc123': 5, '00def456': 10 });
  });

  test('saveCounters merges with existing, taking the max', () => {
    saveCounters(db, accountId, { '00abc123': 5, '00def456': 10 });
    saveCounters(db, accountId, {
      '00abc123': 3,
      '00def456': 15,
      '00ghi789': 2,
    });
    const counters = loadCounters(db, accountId);
    expect(counters).toEqual({
      '00abc123': 5, // kept old value (higher)
      '00def456': 15, // took new value (higher)
      '00ghi789': 2, // new keyset added
    });
  });

  test('advanceCounter updates a single keyset', () => {
    saveCounters(db, accountId, { '00abc123': 5 });
    advanceCounter(db, accountId, '00abc123', 8);
    const counters = loadCounters(db, accountId);
    expect(counters['00abc123']).toBe(8);
  });

  test('advanceCounter does not go backward', () => {
    saveCounters(db, accountId, { '00abc123': 10 });
    advanceCounter(db, accountId, '00abc123', 5);
    const counters = loadCounters(db, accountId);
    expect(counters['00abc123']).toBe(10);
  });

  test('loadCounters handles malformed JSON gracefully', () => {
    db.prepare('UPDATE accounts SET keyset_counters = ? WHERE id = ?').run(
      'not-json',
      accountId,
    );
    const counters = loadCounters(db, accountId);
    expect(counters).toEqual({});
  });

  test('loadCounters handles null gracefully', () => {
    db.prepare('UPDATE accounts SET keyset_counters = NULL WHERE id = ?').run(
      accountId,
    );
    const counters = loadCounters(db, accountId);
    expect(counters).toEqual({});
  });

  test('loadCounters returns empty for nonexistent account', () => {
    const counters = loadCounters(db, 'nonexistent');
    expect(counters).toEqual({});
  });
});
