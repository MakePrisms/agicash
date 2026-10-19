import type { SdkError, TaskProcessorState } from '@agicash/wallet-sdk';
import { useEffect, useSyncExternalStore } from 'react';
import { sdk } from '~/features/shared/sdk.client';
import { useProcessSparkReceiveQuoteTasks } from '../receive/spark-receive-quote-hooks';
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
 * Runs the SDK task processor for this tab and returns its state.
 * The effect owns the loop, so exactly one mounted component may call this
 * (the Wallet layout): the cleanup stops task processing for the whole tab.
 */
export function useTaskProcessor(): {
  state: TaskProcessorState;
  error?: SdkError;
} {
  const userId = useUser((user) => user.id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: userId restarts the loop; it is not read inside
  useEffect(() => {
    sdk.taskProcessor.start();
    return () => {
      void sdk.taskProcessor.stop();
    };
  }, [userId]);
  return useSyncExternalStore(
    subscribeTaskProcessor,
    getTaskProcessorSnapshot,
    () => SERVER_SNAPSHOT,
  );
}

/**
 * Sets up background task processing.
 * Background tasks are tasks processed in the background that do not require user interaction.
 * An example of such task is processing paid cashu mint quote to mint the tokens.
 * Should be used only by the user's lead client.
 */
export const TaskProcessor = () => {
  useProcessSparkReceiveQuoteTasks();
  return null;
};
