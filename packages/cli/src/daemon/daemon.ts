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

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      log(`invalid JSON on stdin: ${trimmed}`);
      return;
    }

    if (!parsed.id || !parsed.method) {
      log(`malformed request (missing id or method): ${trimmed}`);
      if (parsed.id) {
        emit({
          id: parsed.id as string,
          error: { code: 'MALFORMED_REQUEST', message: 'Missing required field: method' },
        });
      }
      return;
    }

    const request = parsed as unknown as DaemonRequest;

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

  // 5. Graceful shutdown (guarded against double-invocation)
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

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

  // 6. Orphan detection — exit if parent process dies
  // When parent dies on Linux, ppid becomes 1 (init). Poll every 5s.
  const originalPpid = process.ppid;
  const orphanCheck = setInterval(() => {
    if (process.ppid !== originalPpid) {
      log(`parent process died (ppid changed from ${originalPpid} to ${process.ppid}), shutting down`);
      clearInterval(orphanCheck);
      void shutdown();
    }
  }, 5000);
  orphanCheck.unref(); // don't keep the process alive just for this timer
}
