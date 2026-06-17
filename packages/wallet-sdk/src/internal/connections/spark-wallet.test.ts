import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { SparkWalletService, createSparkWalletStub } from './spark-wallet';

function fakeWallet(balanceSats: number) {
  return { getInfo: async () => ({ balanceSats }) } as never;
}

describe('SparkWalletService', () => {
  it('connects once per network and reports balance + online', async () => {
    let connects = 0;
    const svc = new SparkWalletService(async () => {
      connects += 1;
      return fakeWallet(1234);
    });
    const a = await svc.getInitialized('MAINNET');
    const b = await svc.getInitialized('MAINNET');
    expect(connects).toBe(1);
    expect(a.isOnline).toBe(true);
    expect((a.balance as Money).toString()).toBe(
      new Money({ amount: 1234, currency: 'BTC', unit: 'sat' }).toString(),
    );
    expect(b.isOnline).toBe(true);
  });

  it('returns an offline stub + null balance when connect fails (and retries next time)', async () => {
    let connects = 0;
    const svc = new SparkWalletService(async () => {
      connects += 1;
      throw new Error('offline');
    });
    const first = await svc.getInitialized('MAINNET');
    expect(first.isOnline).toBe(false);
    expect(first.balance).toBeNull();
    await svc.getInitialized('MAINNET'); // failed connect not cached → retried
    expect(connects).toBe(2);
  });

  it('createSparkWalletStub throws on any method call', () => {
    const stub = createSparkWalletStub('down') as unknown as {
      getInfo: () => unknown;
    };
    expect(() => stub.getInfo()).toThrow('down');
  });
});
