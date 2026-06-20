import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { MeltQuoteSubscriptionManager } from './melt-quote-subscription-manager';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const MINT_URL = 'https://mint.example';

const createWalletHarness = () => {
  const unsubscribe = mock(() => undefined);
  const meltQuoteUpdates = mock(async () => unsubscribe);
  return {
    unsubscribe,
    meltQuoteUpdates,
    getWallet: (() => ({
      on: { meltQuoteUpdates },
      mint: { webSocketConnection: { onClose: () => undefined } },
    })) as unknown as ConstructorParameters<
      typeof MeltQuoteSubscriptionManager
    >[0],
  };
};

describe('MeltQuoteSubscriptionManager.unsubscribeAll', () => {
  let wallet: ReturnType<typeof createWalletHarness>;
  let manager: MeltQuoteSubscriptionManager;

  beforeEach(() => {
    wallet = createWalletHarness();
    manager = new MeltQuoteSubscriptionManager(wallet.getWallet);
  });

  test('closes the open sockets', async () => {
    await manager.subscribe({
      mintUrl: MINT_URL,
      quoteIds: ['q1'],
      onUpdate: () => undefined,
    });

    manager.unsubscribeAll();
    await flush();

    expect(wallet.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('re-subscribes fresh after teardown (no subset reuse)', async () => {
    const args = {
      mintUrl: MINT_URL,
      quoteIds: ['q1'],
      onUpdate: () => undefined,
    };
    await manager.subscribe(args);
    expect(wallet.meltQuoteUpdates).toHaveBeenCalledTimes(1);

    manager.unsubscribeAll();
    await manager.subscribe(args);

    expect(wallet.meltQuoteUpdates).toHaveBeenCalledTimes(2);
  });
});
