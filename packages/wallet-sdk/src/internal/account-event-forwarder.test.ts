/**
 * Account realtime → SDK-event forwarder tests — Slice 5 / PR7.
 *
 * Asserts the name→`op` translation (`ACCOUNT_CREATED` → op `'created'`; `ACCOUNT_UPDATED` → op
 * `'updated'`), version forwarding on the emitted account, and create-dedupe (a second CREATE for
 * an already-seen id is suppressed).
 */
import { describe, expect, mock, test } from 'bun:test';
import { AccountEventForwarder } from './account-event-forwarder';
import { TypedEventEmitter } from './event-emitter';
import type { AccountRepository } from './account-repository';
import type { AgicashDbAccountWithProofs } from './db-account';
import type { SdkEventMap } from '../events';
import type { Account } from '../types/account';

/** A repository whose `toAccount` yields an account with the given id + version. */
function repoYielding(account: Account): AccountRepository {
  return {
    toAccount: mock(async () => account),
  } as unknown as AccountRepository;
}

const account = (id: string, version: number): Account =>
  ({ id, version, type: 'cashu' }) as Account;

/** The DB-change payload is just a row; the forwarder maps it via the repo. */
const payload = { id: 'acc1' } as AgicashDbAccountWithProofs;

describe('AccountEventForwarder (net-new account:updated realtime path, §11)', () => {
  test('ACCOUNT_CREATED → account:updated with op "created" (+version forwarded)', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    const seen: SdkEventMap['account:updated'][] = [];
    events.on('account:updated', (e) => seen.push(e));

    await new AccountEventForwarder(
      repoYielding(account('acc1', 4)),
      events,
    ).handleChange('ACCOUNT_CREATED', payload);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.op).toBe('created');
    expect(seen[0]?.account.id).toBe('acc1');
    expect(seen[0]?.account.version).toBe(4);
  });

  test('ACCOUNT_UPDATED → account:updated with op "updated" (op from the event NAME)', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    const seen: SdkEventMap['account:updated'][] = [];
    events.on('account:updated', (e) => seen.push(e));

    await new AccountEventForwarder(
      repoYielding(account('acc1', 5)),
      events,
    ).handleChange('ACCOUNT_UPDATED', payload);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.op).toBe('updated');
    expect(seen[0]?.account.version).toBe(5);
  });

  test('create-dedupe: a second CREATE for the same id is suppressed', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    let created = 0;
    events.on('account:updated', (e) => {
      if (e.op === 'created') created++;
    });

    const forwarder = new AccountEventForwarder(
      repoYielding(account('acc1', 1)),
      events,
    );
    await forwarder.handleChange('ACCOUNT_CREATED', payload);
    await forwarder.handleChange('ACCOUNT_CREATED', payload);

    expect(created).toBe(1);
  });

  test('an UPDATE is NOT deduped (always re-emitted)', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    let updated = 0;
    events.on('account:updated', (e) => {
      if (e.op === 'updated') updated++;
    });

    const forwarder = new AccountEventForwarder(
      repoYielding(account('acc1', 2)),
      events,
    );
    await forwarder.handleChange('ACCOUNT_UPDATED', payload);
    await forwarder.handleChange('ACCOUNT_UPDATED', payload);

    expect(updated).toBe(2);
  });
});
