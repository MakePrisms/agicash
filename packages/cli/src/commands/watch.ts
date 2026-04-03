import type { WalletClient } from '@agicash/sdk';
import { startTaskProcessors } from '../daemon/task-processors';
import type { SdkContext } from '../sdk-context';

type WatchFlags = {
  receive?: boolean;
  send?: boolean;
};

export async function handleWatchCommand(
  ctx: SdkContext,
  wallet: WalletClient,
  flags: WatchFlags,
): Promise<void> {
  const filter = flags.receive && !flags.send
    ? 'receive'
    : flags.send && !flags.receive
      ? 'send'
      : 'all';

  const handle = await startTaskProcessors(ctx, wallet, {
    filter,
    onEvent(event) {
      process.stdout.write(
        `${JSON.stringify({ event: event.event, ...event.data, ts: event.ts })}\n`,
      );
    },
  });

  // Run until SIGINT/SIGTERM
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      await handle.shutdown();
      await ctx.cleanup();
      resolve();
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });
}
