import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { MintQuoteSubscriptionManager } from './mint-quote-subscription-manager';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const MINT_URL = 'https://mint.example';

const createWalletHarness = () => {
  const unsubscribe = mock(() => undefined);
  const mintQuoteUpdates = mock(async () => unsubscribe);
  return {
    unsubscribe,
    mintQuoteUpdates,
    getWallet: (() => ({
      on: { mintQuoteUpdates },
      mint: { webSocketConnection: { onClose: () => undefined } },
    })) as unknown as ConstructorParameters<
      typeof MintQuoteSubscriptionManager
    >[0],
  };
};

describe('MintQuoteSubscriptionManager.unsubscribeAll', () => {
  let wallet: ReturnType<typeof createWalletHarness>;
  let manager: MintQuoteSubscriptionManager;

  beforeEach(() => {
    wallet = createWalletHarness();
    manager = new MintQuoteSubscriptionManager(wallet.getWallet);
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
    expect(wallet.mintQuoteUpdates).toHaveBeenCalledTimes(1);

    manager.unsubscribeAll();
    await manager.subscribe(args);

    expect(wallet.mintQuoteUpdates).toHaveBeenCalledTimes(2);
  });
});
