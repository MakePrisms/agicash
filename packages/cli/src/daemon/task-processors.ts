import {
  SupabaseRealtimeManager,
  TaskProcessingLockRepository,
  type WalletClient,
} from '@agicash/sdk';
import type { SdkContext } from '../sdk-context';
import type { DaemonEvent, DaemonEventName, DaemonEventMap } from './protocol';

type TaskProcessorFilter = 'receive' | 'send' | 'all';

type OnEventCallback = (event: DaemonEvent) => void;

export type TaskProcessorHandle = {
  shutdown(): Promise<void>;
};

function buildEvent<E extends DaemonEventName>(
  event: E,
  data: DaemonEventMap[E],
): DaemonEvent<E> {
  return { event, data, ts: new Date().toISOString() };
}

function buildProcessorList(
  wallet: WalletClient,
  filter: TaskProcessorFilter,
): Array<{
  name: string;
  processor: { start(): Promise<void>; stop(): Promise<void> };
}> {
  const all = filter === 'all';
  const processors: Array<{
    name: string;
    processor: { start(): Promise<void>; stop(): Promise<void> };
  }> = [];

  if (all || filter === 'receive') {
    processors.push(
      {
        name: 'cashuReceiveQuote',
        processor: wallet.taskProcessors.cashuReceiveQuote,
      },
      {
        name: 'cashuReceiveSwap',
        processor: wallet.taskProcessors.cashuReceiveSwap,
      },
      {
        name: 'sparkReceiveQuote',
        processor: wallet.taskProcessors.sparkReceiveQuote,
      },
    );
  }

  if (all || filter === 'send') {
    processors.push(
      {
        name: 'cashuSendQuote',
        processor: wallet.taskProcessors.cashuSendQuote,
      },
      {
        name: 'cashuSendSwap',
        processor: wallet.taskProcessors.cashuSendSwap,
      },
      {
        name: 'sparkSendQuote',
        processor: wallet.taskProcessors.sparkSendQuote,
      },
    );
  }

  return processors;
}

function wireEventListeners(
  wallet: WalletClient,
  filter: TaskProcessorFilter,
  onEvent: OnEventCallback,
): () => void {
  const all = filter === 'all';
  // Track all listeners so we can remove them on cleanup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registrations: Array<{ emitter: any; event: string; handler: (...args: any[]) => void }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function on(emitter: any, event: string, handler: (...args: any[]) => void): void {
    emitter.on(event, handler);
    registrations.push({ emitter, event, handler });
  }

  if (all || filter === 'receive') {
    on(wallet.taskProcessors.cashuReceiveQuote, 'receive:minted', (event) => {
      onEvent(
        buildEvent('receive:minted', {
          quoteId: event.quote.id,
          amount: event.quote.amount.toString(),
          accountId: event.quote.accountId,
        }),
      );
    });
    on(wallet.taskProcessors.cashuReceiveQuote, 'receive:expired', (event) => {
      onEvent(buildEvent('receive:expired', { quoteId: event.quoteId }));
    });
    on(wallet.taskProcessors.cashuReceiveQuote, 'error', (event) => {
      onEvent(
        buildEvent('error', {
          processor: 'cashuReceiveQuote',
          action: event.action,
          message: String(event.error),
          quoteId: event.quoteId,
        }),
      );
    });

    on(wallet.taskProcessors.cashuReceiveSwap, 'swap:completed', (event) => {
      onEvent(
        buildEvent('receive:swap:completed', {
          tokenHash: event.swap.tokenHash,
        }),
      );
    });
    on(wallet.taskProcessors.cashuReceiveSwap, 'error', (event) => {
      onEvent(
        buildEvent('error', {
          processor: 'cashuReceiveSwap',
          action: event.action,
          message: String(event.error),
        }),
      );
    });

    on(wallet.taskProcessors.sparkReceiveQuote, 'receive:completed', (event) => {
      onEvent(
        buildEvent('spark:receive:completed', { quoteId: event.quote.id }),
      );
    });
    on(wallet.taskProcessors.sparkReceiveQuote, 'receive:expired', (event) => {
      onEvent(
        buildEvent('spark:receive:expired', { quoteId: event.quoteId }),
      );
    });
    on(wallet.taskProcessors.sparkReceiveQuote, 'error', (event) => {
      onEvent(
        buildEvent('error', {
          processor: 'sparkReceiveQuote',
          action: event.action,
          message: String(event.error),
        }),
      );
    });
  }

  if (all || filter === 'send') {
    on(wallet.taskProcessors.cashuSendQuote, 'send:completed', (event) => {
      onEvent(buildEvent('send:completed', { quoteId: event.quoteId }));
    });
    on(wallet.taskProcessors.cashuSendQuote, 'send:failed', (event) => {
      onEvent(
        buildEvent('send:failed', {
          quoteId: event.quoteId,
          reason: event.reason,
        }),
      );
    });
    on(wallet.taskProcessors.cashuSendQuote, 'error', (event) => {
      onEvent(
        buildEvent('error', {
          processor: 'cashuSendQuote',
          action: event.action,
          message: String(event.error),
        }),
      );
    });

    on(wallet.taskProcessors.cashuSendSwap, 'swap:completed', (event) => {
      onEvent(
        buildEvent('send:swap:completed', { swapId: event.swapId }),
      );
    });
    on(wallet.taskProcessors.cashuSendSwap, 'error', (event) => {
      onEvent(
        buildEvent('error', {
          processor: 'cashuSendSwap',
          action: event.action,
          message: String(event.error),
        }),
      );
    });

    on(wallet.taskProcessors.sparkSendQuote, 'send:completed', (event) => {
      onEvent(
        buildEvent('spark:send:completed', { quoteId: event.quoteId }),
      );
    });
    on(wallet.taskProcessors.sparkSendQuote, 'send:failed', (event) => {
      onEvent(
        buildEvent('spark:send:failed', { quoteId: event.quoteId }),
      );
    });
    on(wallet.taskProcessors.sparkSendQuote, 'error', (event) => {
      onEvent(
        buildEvent('error', {
          processor: 'sparkSendQuote',
          action: event.action,
          message: String(event.error),
        }),
      );
    });
  }

  // Return cleanup function that removes all registered listeners
  return () => {
    for (const { emitter, event, handler } of registrations) {
      emitter.removeListener(event, handler);
    }
    registrations.length = 0;
  };
}

export async function startTaskProcessors(
  ctx: SdkContext,
  wallet: WalletClient,
  options: {
    filter?: TaskProcessorFilter;
    onEvent: OnEventCallback;
  },
): Promise<TaskProcessorHandle> {
  const filter = options.filter ?? 'all';
  const { onEvent } = options;

  const processors = buildProcessorList(wallet, filter);
  const removeListeners = wireEventListeners(wallet, filter, onEvent);

  // Start realtime handler for cache invalidation
  const supabaseClient = (
    await import('../supabase-client')
  ).getSupabaseClient();
  const realtimeManager = new SupabaseRealtimeManager(supabaseClient.realtime);
  const realtimeHandler = wallet.createRealtimeHandler(realtimeManager);

  await realtimeHandler.start();
  onEvent(buildEvent('watch:realtime:connected', {}));

  // Leader election — same pattern as the web app's useTakeTaskProcessingLead.
  // Only the lead client runs task processors. The lock expires after 6s (DB-side),
  // so polling every 5s keeps it alive.
  const clientId = crypto.randomUUID();
  const lockRepo = new TaskProcessingLockRepository(supabaseClient);
  let isLead = false;
  let processorsRunning = false;

  const pollLead = async () => {
    try {
      const gotLead = await lockRepo.takeLead(ctx.userId, clientId);

      if (gotLead && !isLead) {
        isLead = true;
        onEvent(buildEvent('watch:lead:acquired', { clientId }));
        if (!processorsRunning) {
          await Promise.all(
            processors.map(({ processor }) => processor.start()),
          );
          processorsRunning = true;
          onEvent(
            buildEvent('watch:started', {
              processors: processors.map(({ name }) => name),
              filters: filter,
            }),
          );
        }
      } else if (!gotLead && isLead) {
        isLead = false;
        onEvent(buildEvent('watch:lead:lost', { clientId }));
        if (processorsRunning) {
          await Promise.all(
            processors.map(({ processor }) => processor.stop()),
          );
          processorsRunning = false;
          onEvent(buildEvent('watch:processors:stopped', {}));
        }
      }
    } catch (err) {
      onEvent(
        buildEvent('error', {
          processor: 'leaderElection',
          action: 'pollLead',
          message: String(err),
        }),
      );
    }
  };

  // Initial poll, then every 5s (matches web app's refetchInterval)
  await pollLead();
  const leadInterval = setInterval(() => void pollLead(), 5000);

  return {
    async shutdown() {
      onEvent(buildEvent('watch:stopping', {}));
      clearInterval(leadInterval);
      removeListeners();
      if (processorsRunning) {
        await Promise.all(
          processors.map(({ processor }) => processor.stop()),
        );
      }
      await realtimeHandler.stop();
      onEvent(buildEvent('watch:stopped', {}));
    },
  };
}
