/**
 * Task-processing lock repository tests — Slice 5 / PR7 (verbatim lift).
 *
 * Asserts the `take_lead` RPC is called with the user + client id, the result is returned, the
 * abort signal is threaded through, and an RPC error is wrapped.
 */
import { describe, expect, mock, test } from 'bun:test';
import { TaskProcessingLockRepository } from './task-processing-lock-repository';
import type { WalletSupabaseClient } from './supabase-client';

/**
 * A fake supabase client whose `rpc` returns a thenable query (a real resolved Promise with an
 * `abortSignal` method attached) — `await query` yields `{ data, error }`, mirroring supabase-js's
 * `PostgrestFilterBuilder` (itself a thenable that exposes `abortSignal`).
 */
function fakeDb(result: { data?: boolean; error?: unknown }) {
  const abortSignal = mock((_signal: AbortSignal) => query);
  const query = Object.assign(Promise.resolve(result), { abortSignal });
  const rpc = mock((_fn: string, _args: unknown) => query);
  const db = { rpc } as unknown as WalletSupabaseClient;
  return { db, rpc, abortSignal };
}

describe('TaskProcessingLockRepository', () => {
  test('calls take_lead with the user + client id and returns the result', async () => {
    const { db, rpc } = fakeDb({ data: true });
    const repo = new TaskProcessingLockRepository(db);

    const result = await repo.takeLead('user-1', 'client-1');

    expect(result).toBe(true);
    expect(rpc).toHaveBeenCalledWith('take_lead', {
      p_user_id: 'user-1',
      p_client_id: 'client-1',
    });
  });

  test('threads the abort signal through when provided', async () => {
    const { db, abortSignal } = fakeDb({ data: false });
    const repo = new TaskProcessingLockRepository(db);
    const controller = new AbortController();

    await repo.takeLead('user-1', 'client-1', {
      abortSignal: controller.signal,
    });

    expect(abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  test('wraps an RPC error', async () => {
    const { db } = fakeDb({ error: new Error('rpc failed') });
    const repo = new TaskProcessingLockRepository(db);

    await expect(repo.takeLead('user-1', 'client-1')).rejects.toThrow(
      'Take lead request failed',
    );
  });
});
