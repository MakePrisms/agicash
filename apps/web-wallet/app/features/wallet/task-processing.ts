import type { SdkError, TaskProcessorState } from '@agicash/wallet-sdk';
import { useEffect, useSyncExternalStore } from 'react';
import { sdk } from '~/features/shared/sdk.client';
import { useUser } from '../user/user-hooks';

const SERVER_SNAPSHOT: { state: TaskProcessorState; error?: SdkError } = {
  state: 'stopped',
};

let cached: { state: TaskProcessorState; error?: SdkError } = SERVER_SNAPSHOT;

function publish(next: { state: TaskProcessorState; error?: SdkError }): void {
  if (cached.state === next.state && cached.error === next.error) {
    return;
  }
  cached = next;
}

function subscribeTaskProcessor(onStoreChange: () => void): () => void {
  publish(
    sdk.taskProcessor.state === 'error'
      ? cached.state === 'error'
        ? cached
        : { state: 'error' }
      : { state: sdk.taskProcessor.state },
  );
  return sdk.events.on('task-processor.state-changed', (payload) => {
    publish(
      payload.state === 'error'
        ? { state: payload.state, error: payload.error }
        : { state: payload.state },
    );
    onStoreChange();
  });
}

function getTaskProcessorSnapshot(): {
  state: TaskProcessorState;
  error?: SdkError;
} {
  const current = sdk.taskProcessor.state;
  if (cached.state !== current && current !== 'error') {
    publish({ state: current });
  }
  return cached;
}

/**
 * Runs the SDK task processor for this tab and throws when it enters
 * 'error', so the nearest error boundary shows it.
 * The effect owns the loop, so exactly one mounted component may call this
 * (the Wallet layout): the cleanup stops task processing for the whole tab.
 */
export function useTaskProcessor(): void {
  const userId = useUser((user) => user.id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: userId restarts the loop; it is not read inside
  useEffect(() => {
    sdk.taskProcessor.start();
    return () => {
      void sdk.taskProcessor.stop();
    };
  }, [userId]);
  const { state, error } = useSyncExternalStore(
    subscribeTaskProcessor,
    getTaskProcessorSnapshot,
    () => SERVER_SNAPSHOT,
  );
  if (state === 'error') {
    throw error ?? new Error('Task processor entered error');
  }
}
