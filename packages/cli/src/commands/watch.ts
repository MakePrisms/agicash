import { SupabaseRealtimeManager, type WalletClient } from '@agicash/sdk';
import type { SdkContext } from '../sdk-context';

type WatchFlags = {
  receive?: boolean;
  send?: boolean;
};

function emitEvent(event: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({ ...event, ts: new Date().toISOString() })}\n`,
  );
}

export async function handleWatchCommand(
  ctx: SdkContext,
  wallet: WalletClient,
  flags: WatchFlags,
): Promise<void> {
  const filterReceive = flags.receive && !flags.send;
  const filterSend = flags.send && !flags.receive;
  const all = !filterReceive && !filterSend;

  const processors: Array<{
    name: string;
    processor: { start(): Promise<void>; stop(): Promise<void> };
  }> = [];

  if (all || filterReceive) {
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

  if (all || filterSend) {
    processors.push(
      {
        name: 'cashuSendQuote',
        processor: wallet.taskProcessors.cashuSendQuote,
      },
      { name: 'cashuSendSwap', processor: wallet.taskProcessors.cashuSendSwap },
      {
        name: 'sparkSendQuote',
        processor: wallet.taskProcessors.sparkSendQuote,
      },
    );
  }

  // Wire event listeners for all active processors
  if (all || filterReceive) {
    wallet.taskProcessors.cashuReceiveQuote.on('receive:minted', (event) => {
      emitEvent({
        event: 'receive:minted',
        quoteId: event.quote.id,
        amount: event.quote.amount.toString(),
        accountId: event.quote.accountId,
      });
    });
    wallet.taskProcessors.cashuReceiveQuote.on('receive:expired', (event) => {
      emitEvent({ event: 'receive:expired', quoteId: event.quoteId });
    });
    wallet.taskProcessors.cashuReceiveQuote.on('error', (event) => {
      emitEvent({
        event: 'error',
        processor: 'cashuReceiveQuote',
        action: event.action,
        quoteId: event.quoteId,
        message: String(event.error),
      });
    });

    wallet.taskProcessors.cashuReceiveSwap.on('swap:completed', (event) => {
      emitEvent({
        event: 'receive:swap:completed',
        tokenHash: event.swap.tokenHash,
      });
    });
    wallet.taskProcessors.cashuReceiveSwap.on('error', (event) => {
      emitEvent({
        event: 'error',
        processor: 'cashuReceiveSwap',
        action: event.action,
        message: String(event.error),
      });
    });

    wallet.taskProcessors.sparkReceiveQuote.on('receive:completed', (event) => {
      emitEvent({ event: 'spark:receive:completed', quoteId: event.quote.id });
    });
    wallet.taskProcessors.sparkReceiveQuote.on('receive:expired', (event) => {
      emitEvent({ event: 'spark:receive:expired', quoteId: event.quoteId });
    });
    wallet.taskProcessors.sparkReceiveQuote.on('error', (event) => {
      emitEvent({
        event: 'error',
        processor: 'sparkReceiveQuote',
        action: event.action,
        message: String(event.error),
      });
    });
  }

  if (all || filterSend) {
    wallet.taskProcessors.cashuSendQuote.on('send:completed', (event) => {
      emitEvent({ event: 'send:completed', quoteId: event.quoteId });
    });
    wallet.taskProcessors.cashuSendQuote.on('send:failed', (event) => {
      emitEvent({
        event: 'send:failed',
        quoteId: event.quoteId,
        reason: event.reason,
      });
    });
    wallet.taskProcessors.cashuSendQuote.on('error', (event) => {
      emitEvent({
        event: 'error',
        processor: 'cashuSendQuote',
        action: event.action,
        message: String(event.error),
      });
    });

    wallet.taskProcessors.cashuSendSwap.on('swap:completed', (event) => {
      emitEvent({ event: 'send:swap:completed', swapId: event.swapId });
    });
    wallet.taskProcessors.cashuSendSwap.on('error', (event) => {
      emitEvent({
        event: 'error',
        processor: 'cashuSendSwap',
        action: event.action,
        message: String(event.error),
      });
    });

    wallet.taskProcessors.sparkSendQuote.on('send:completed', (event) => {
      emitEvent({ event: 'spark:send:completed', quoteId: event.quoteId });
    });
    wallet.taskProcessors.sparkSendQuote.on('send:failed', (event) => {
      emitEvent({ event: 'spark:send:failed', quoteId: event.quoteId });
    });
    wallet.taskProcessors.sparkSendQuote.on('error', (event) => {
      emitEvent({
        event: 'error',
        processor: 'sparkSendQuote',
        action: event.action,
        message: String(event.error),
      });
    });
  }

  // Start realtime handler for cache invalidation
  const supabaseClient = (
    await import('../supabase-client')
  ).getSupabaseClient();
  const realtimeManager = new SupabaseRealtimeManager(supabaseClient.realtime);
  const realtimeHandler = wallet.createRealtimeHandler(realtimeManager);

  await realtimeHandler.start();
  emitEvent({ event: 'watch:realtime:connected' });

  // Start all selected processors
  await Promise.all(processors.map(({ processor }) => processor.start()));
  emitEvent({
    event: 'watch:started',
    processors: processors.map(({ name }) => name),
    filters: filterReceive ? 'receive' : filterSend ? 'send' : 'all',
  });

  // Run until SIGINT
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      emitEvent({ event: 'watch:stopping' });

      await Promise.all(processors.map(({ processor }) => processor.stop()));
      await realtimeHandler.stop();
      await ctx.cleanup();

      emitEvent({ event: 'watch:stopped' });
      resolve();
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });
}
