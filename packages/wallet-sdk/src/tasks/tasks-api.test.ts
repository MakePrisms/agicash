import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient } from '@tanstack/query-core';
import type { TaskProcessingLockRepository } from '../task-processing-lock-repository';
import type { SagaProcessor } from './processor';
import { type TasksApi, createTasksApi } from './tasks-api';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const waitForStatus = async (api: TasksApi, expected: string) => {
  for (let i = 0; i < 50; i++) {
    if (api.getStatus() === expected) {
      return;
    }
    await flush();
  }
  throw new Error(
    `Timed out waiting for status "${expected}"; last was "${api.getStatus()}"`,
  );
};

/**
 * Builds an engine over a real query-core client and a fake lock repository.
 * `takeLead` controls the leader-election result.
 */
const setup = (
  takeLead: (userId: string, clientId: string) => Promise<boolean>,
  options?: {
    getCurrentUserId?: () => string;
    processors?: SagaProcessor[];
  },
) => {
  const queryClient = new QueryClient();
  const takeLeadMock = mock(takeLead);
  const taskProcessingLockRepository = {
    takeLead: takeLeadMock,
  } as unknown as TaskProcessingLockRepository;

  const api = createTasksApi({
    queryClient,
    taskProcessingLockRepository,
    getCurrentUserId: options?.getCurrentUserId ?? (() => 'user-1'),
    processors: options?.processors ?? [],
  });

  return { api, takeLeadMock, queryClient };
};

describe('createTasksApi', () => {
  let running: TasksApi | undefined;

  afterEach(() => {
    // Tear down any observer so its refetchInterval timer does not leak.
    running?.stop();
    running = undefined;
  });

  it('starts in the stopped state with no error', () => {
    const { api } = setup(async () => true);
    expect(api.getStatus()).toBe('stopped');
    expect(api.getError()).toBeNull();
  });

  it('transitions to leader when takeLead returns true', async () => {
    const { api } = setup(async () => true);
    running = api;

    api.start();
    await waitForStatus(api, 'leader');

    expect(api.getStatus()).toBe('leader');
    expect(api.getError()).toBeNull();
  });

  it('transitions to follower when takeLead returns false', async () => {
    const { api } = setup(async () => false);
    running = api;

    api.start();
    await waitForStatus(api, 'follower');

    expect(api.getStatus()).toBe('follower');
    expect(api.getError()).toBeNull();
  });

  it('transitions to error when the leader poll fails', async () => {
    const failure = new Error('take_lead failed');
    const { api } = setup(async () => {
      throw failure;
    });
    running = api;

    api.start();
    await waitForStatus(api, 'error');

    expect(api.getStatus()).toBe('error');
    expect(api.getError()).toBe(failure);
  });

  it('resets to stopped on stop()', async () => {
    const { api } = setup(async () => true);
    api.start();
    await waitForStatus(api, 'leader');

    api.stop();

    expect(api.getStatus()).toBe('stopped');
    expect(api.getError()).toBeNull();
  });

  it('clears a prior error when stopped', async () => {
    const { api } = setup(async () => {
      throw new Error('boom');
    });
    api.start();
    await waitForStatus(api, 'error');

    api.stop();

    expect(api.getStatus()).toBe('stopped');
    expect(api.getError()).toBeNull();
  });

  it('notifies onStatusChange subscribers on each transition', async () => {
    const { api } = setup(async () => true);
    running = api;
    const listener = mock(() => undefined);
    const unsubscribe = api.onStatusChange(listener);

    api.start();
    await waitForStatus(api, 'leader');
    expect(listener.mock.calls.length).toBeGreaterThan(0);

    const callsAfterLeader = listener.mock.calls.length;
    api.stop();
    // stop() is a stopped<-leader transition, so it fires again.
    expect(listener.mock.calls.length).toBe(callsAfterLeader + 1);

    unsubscribe();
    listener.mockClear();
    api.start();
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it('start() is idempotent — a second call does not start a second election', async () => {
    const { api, takeLeadMock } = setup(async () => false);
    running = api;

    api.start();
    await waitForStatus(api, 'follower');
    const callsAfterFirstStart = takeLeadMock.mock.calls.length;
    expect(callsAfterFirstStart).toBeGreaterThan(0);

    // Second start while running is a no-op (no fresh observer, no extra poll).
    api.start();
    await flush();
    expect(takeLeadMock.mock.calls.length).toBe(callsAfterFirstStart);
  });

  it('stop() is idempotent', () => {
    const { api } = setup(async () => true);
    expect(() => {
      api.stop();
      api.stop();
    }).not.toThrow();
    expect(api.getStatus()).toBe('stopped');
  });

  it('can restart after stop()', async () => {
    const { api } = setup(async () => true);
    running = api;

    api.start();
    await waitForStatus(api, 'leader');
    api.stop();
    expect(api.getStatus()).toBe('stopped');

    api.start();
    await waitForStatus(api, 'leader');
    expect(api.getStatus()).toBe('leader');
  });

  it('derives the user id from getCurrentUserId, not a caller arg', async () => {
    const { api, takeLeadMock } = setup(async () => true, {
      getCurrentUserId: () => 'derived-user',
    });
    running = api;

    api.start();
    await waitForStatus(api, 'leader');

    expect(takeLeadMock).toHaveBeenCalledWith(
      'derived-user',
      expect.any(String),
    );
  });

  it('uses a caller-supplied clientId when given', async () => {
    const { api, takeLeadMock } = setup(async () => true);
    running = api;

    api.start({ clientId: 'fixed-client' });
    await waitForStatus(api, 'leader');

    expect(takeLeadMock).toHaveBeenCalledWith('user-1', 'fixed-client');
  });

  const makeProcessor = () => {
    const activate = mock(() => undefined);
    const deactivate = mock(() => undefined);
    const processor: SagaProcessor = { activate, deactivate };
    return { processor, activate, deactivate };
  };

  it('activates processors only on becoming leader', async () => {
    const { processor, activate, deactivate } = makeProcessor();
    const { api } = setup(async () => true, { processors: [processor] });
    running = api;

    expect(activate).not.toHaveBeenCalled();

    api.start();
    await waitForStatus(api, 'leader');

    expect(activate).toHaveBeenCalledTimes(1);
    expect(deactivate).not.toHaveBeenCalled();
  });

  it('does not activate processors while only a follower', async () => {
    const { processor, activate, deactivate } = makeProcessor();
    const { api } = setup(async () => false, { processors: [processor] });
    running = api;

    api.start();
    await waitForStatus(api, 'follower');
    await flush();

    expect(activate).not.toHaveBeenCalled();
    expect(deactivate).not.toHaveBeenCalled();
  });

  it('deactivates processors when leadership is lost (stop)', async () => {
    const { processor, activate, deactivate } = makeProcessor();
    const { api } = setup(async () => true, { processors: [processor] });
    running = api;

    api.start();
    await waitForStatus(api, 'leader');
    expect(activate).toHaveBeenCalledTimes(1);

    api.stop();

    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it('deactivates processors when the leader poll starts failing', async () => {
    let succeed = true;
    const { processor, activate, deactivate } = makeProcessor();
    const { api, queryClient } = setup(
      async () => {
        if (!succeed) {
          throw new Error('lost lease');
        }
        return true;
      },
      { processors: [processor] },
    );
    running = api;

    api.start();
    await waitForStatus(api, 'leader');
    expect(activate).toHaveBeenCalledTimes(1);

    succeed = false;
    await queryClient.invalidateQueries({ queryKey: ['take-lead'] });
    await waitForStatus(api, 'error');

    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it('does not re-activate processors on a redundant leader poll', async () => {
    const { processor, activate } = makeProcessor();
    const { api, queryClient } = setup(async () => true, {
      processors: [processor],
    });
    running = api;

    api.start();
    await waitForStatus(api, 'leader');
    await queryClient.invalidateQueries({ queryKey: ['take-lead'] });
    await flush();

    // Still leader across two successful polls — activate fires once.
    expect(activate).toHaveBeenCalledTimes(1);
  });
});
