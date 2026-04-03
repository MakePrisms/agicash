import { createInterface } from 'node:readline';
import { getSdkContext } from '../sdk-context';
import type {
  DaemonEvent,
  DaemonEventMap,
  DaemonEventName,
  DaemonMessage,
  DaemonRequest,
} from './protocol';
import { createRouterState, routeRequest } from './router';
import { startTaskProcessors } from './task-processors';

function emit(msg: DaemonMessage): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function emitEvent<E extends DaemonEventName>(
  event: E,
  data: DaemonEventMap[E],
): void {
  emit({ event, data, ts: new Date().toISOString() } as DaemonEvent);
}

function log(message: string): void {
  process.stderr.write(`[daemon] ${message}\n`);
}

export async function runDaemon(): Promise<void> {
  log('starting...');

  // 1. Initialize SDK context (warm wallet)
  let ctx;
  try {
    ctx = await getSdkContext();
  } catch (err) {
    emitEvent('daemon:error', {
      message: `SDK context init failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }

  const wallet = ctx.wallet;

  // Shared event emitter for task processors
  const onEvent = (event: DaemonEvent) => emit(event);

  // 2. Start task processors (always watching on startup)
  let taskProcessorHandle;
  try {
    taskProcessorHandle = await startTaskProcessors(ctx, wallet, {
      filter: 'all',
      onEvent,
    });
  } catch (err) {
    emitEvent('daemon:error', {
      message: `Task processor start failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    await ctx.cleanup();
    process.exit(1);
  }

  // Router state holds the active task processor handle
  const routerState = createRouterState(taskProcessorHandle, onEvent);

  // 3. Emit ready
  emitEvent('daemon:ready', {});
  log('ready');

  // 4. Read JSONL from stdin
  const rl = createInterface({ input: process.stdin });

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: DaemonRequest;
    try {
      request = JSON.parse(trimmed) as DaemonRequest;
    } catch {
      log(`invalid JSON on stdin: ${trimmed}`);
      return;
    }

    if (!request.id || !request.method) {
      log(`malformed request (missing id or method): ${trimmed}`);
      return;
    }

    // Route request asynchronously, emit response when done
    void routeRequest(request, ctx, wallet, routerState)
      .then((response) => emit(response))
      .catch((err) => {
        emit({
          id: request.id,
          error: {
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        });
      });
  });

  // 5. Graceful shutdown
  const shutdown = async () => {
    log('shutting down...');
    rl.close();

    if (routerState.taskProcessorHandle) {
      await routerState.taskProcessorHandle.shutdown();
    }
    await ctx.cleanup();

    log('shutdown complete');
    process.exit(0);
  };

  // Stdin close means the parent process disconnected
  rl.on('close', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
