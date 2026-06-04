/**
 * Leader-election timer-loop tests — Slice 5 / PR7 (background).
 *
 * Drives the manually-pumpable `pollOnce` core (no real 5 s timer) over a faked lock repo,
 * asserting: the first poll reports leader/follower; `onChange` fires only on a STATUS FLIP (not
 * every poll); a signed-out poll reports follower without calling `take_lead`; a failed poll keeps
 * the last status (no flap); and `stop()` aborts an in-flight poll + resets the reported status.
 */
import { describe, expect, mock, test } from 'bun:test';
import { LeaderElection, type LeadStatus } from './leader-election';
import type { TaskProcessingLockRepository } from './task-processing-lock-repository';

/** A fake lock repo whose `takeLead` returns a queued/spied result. */
function fakeLock(
  takeLead: (userId: string, clientId: string) => Promise<boolean>,
): TaskProcessingLockRepository {
  return {
    takeLead: mock(takeLead),
  } as unknown as TaskProcessingLockRepository;
}

function makeElection(opts: {
  lock: TaskProcessingLockRepository;
  userId?: string | null;
}) {
  const changes: LeadStatus[] = [];
  const election = new LeaderElection({
    lockRepository: opts.lock,
    clientId: 'client-1',
    getUserId: async () => (opts.userId === undefined ? 'user-1' : opts.userId),
    onChange: (status) => changes.push(status),
  });
  return { election, changes };
}

describe('LeaderElection', () => {
  test('a first poll that wins reports leader', async () => {
    const lock = fakeLock(async () => true);
    const { election, changes } = makeElection({ lock });

    await election.pollOnce();

    expect(changes).toEqual(['leader']);
    expect(election.current()).toBe('leader');
  });

  test('a first poll that loses reports follower', async () => {
    const lock = fakeLock(async () => false);
    const { election, changes } = makeElection({ lock });

    await election.pollOnce();

    expect(changes).toEqual(['follower']);
    expect(election.current()).toBe('follower');
  });

  test('onChange fires only on a status FLIP, not every poll', async () => {
    let isLeader = false;
    const lock = fakeLock(async () => isLeader);
    const { election, changes } = makeElection({ lock });

    await election.pollOnce(); // follower
    await election.pollOnce(); // still follower -> no event
    isLeader = true;
    await election.pollOnce(); // -> leader
    await election.pollOnce(); // still leader -> no event
    isLeader = false;
    await election.pollOnce(); // -> follower

    expect(changes).toEqual(['follower', 'leader', 'follower']);
  });

  test('a signed-out poll reports follower without calling take_lead', async () => {
    const lock = fakeLock(async () => true);
    const { election, changes } = makeElection({ lock, userId: null });

    await election.pollOnce();

    expect(changes).toEqual(['follower']);
    expect((lock.takeLead as ReturnType<typeof mock>).mock.calls).toHaveLength(
      0,
    );
  });

  test('a failed poll keeps the last status (no flap) and logs', async () => {
    const warn = mock(() => undefined);
    const original = console.warn;
    console.warn = warn;
    try {
      let mode: 'ok' | 'throw' = 'ok';
      const lock = fakeLock(async () => {
        if (mode === 'throw') throw new Error('db down');
        return true;
      });
      const { election, changes } = makeElection({ lock });

      await election.pollOnce(); // leader
      mode = 'throw';
      await election.pollOnce(); // fails -> stays leader, no new event

      expect(changes).toEqual(['leader']);
      expect(election.current()).toBe('leader');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = original;
    }
  });

  test('stop() aborts an in-flight take_lead and resets the known status', async () => {
    // `takeLead` rejects when its abort signal fires (mimics supabase-js abort behaviour).
    const lock = {
      takeLead: mock(
        (
          _userId: string,
          _clientId: string,
          options?: { abortSignal?: AbortSignal },
        ) =>
          new Promise<boolean>((_resolve, reject) => {
            options?.abortSignal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      ),
    } as unknown as TaskProcessingLockRepository;
    const { election, changes } = makeElection({ lock });

    const poll = election.pollOnce();
    // Let the poll reach the (pending) takeLead call.
    await new Promise((r) => setTimeout(r, 0));
    election.stop(); // aborts the in-flight signal → takeLead rejects
    await poll;

    // The abort rejection was swallowed (no status reported), and stop() reset the known status.
    expect(changes).toEqual([]);
    expect(election.current()).toBe('follower'); // reset → defaults to follower
  });

  test('start() is idempotent and runs an immediate first poll', async () => {
    const lock = fakeLock(async () => true);
    const { election, changes } = makeElection({ lock });

    election.start();
    election.start(); // second call is a no-op (no double timer)
    // Let the immediate first poll's microtasks settle.
    await new Promise((r) => setTimeout(r, 0));
    election.stop();

    expect(changes).toEqual(['leader']);
  });
});
