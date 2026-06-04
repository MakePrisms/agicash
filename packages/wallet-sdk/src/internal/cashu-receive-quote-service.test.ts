import { describe, expect, mock, test } from 'bun:test';
import type { CashuCryptography } from './cashu-receive-quote-service';
import { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import { type Currency, Money } from '../types/money';
import type { CashuReceiveQuote } from '../types/cashu';

// -- Fakes ----------------------------------------------------------------------------------

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

function fakeCrypto(): CashuCryptography {
  return {
    getXpub: mock(async () => 'xpub'),
    getPrivateKey: mock(async () => 'privkey'),
  };
}

function fakeRepo(): CashuReceiveQuoteRepository {
  return {
    expire: mock(async () => undefined),
    fail: mock(async () => undefined),
    markMeltInitiated: mock(async (q: CashuReceiveQuote) => q),
    create: mock(async () => quote({})),
  } as unknown as CashuReceiveQuoteRepository;
}

/** Build a LIGHTNING receive quote in the given state. */
function quote(
  overrides: Partial<CashuReceiveQuote> & {
    state?: CashuReceiveQuote['state'];
  },
): CashuReceiveQuote {
  return {
    id: 'rq1',
    userId: 'u1',
    accountId: 'acc1',
    transactionId: 'tx1',
    quoteId: 'mint1',
    amount: sats(100),
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
    paymentRequest: 'lnbc1...',
    paymentHash: 'hash',
    lockingDerivationPath: "m/129372'/0'/0'/1",
    totalFee: sats(0),
    version: 1,
    type: 'LIGHTNING',
    state: 'UNPAID',
    ...overrides,
  } as CashuReceiveQuote;
}

// -- Tests ----------------------------------------------------------------------------------

describe('CashuReceiveQuoteService idempotency guards', () => {
  test('expire is a no-op when already EXPIRED', async () => {
    const repo = fakeRepo();
    const service = new CashuReceiveQuoteService(fakeCrypto(), repo);

    await service.expire(quote({ state: 'EXPIRED' } as never));

    expect(repo.expire).not.toHaveBeenCalled();
  });

  test('expire rejects a not-yet-expired quote', async () => {
    const service = new CashuReceiveQuoteService(fakeCrypto(), fakeRepo());
    const future = quote({
      state: 'UNPAID',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(service.expire(future)).rejects.toThrow(/has not expired/);
  });

  test('fail is a no-op when already FAILED', async () => {
    const repo = fakeRepo();
    const service = new CashuReceiveQuoteService(fakeCrypto(), repo);

    await service.fail(
      quote({ state: 'FAILED', failureReason: 'x' } as never),
      'r',
    );

    expect(repo.fail).not.toHaveBeenCalled();
  });

  test('fail rejects a non-UNPAID quote', async () => {
    const service = new CashuReceiveQuoteService(fakeCrypto(), fakeRepo());
    await expect(
      service.fail(quote({ state: 'COMPLETED' } as never), 'r'),
    ).rejects.toThrow(/not unpaid/);
  });

  test('markMeltInitiated rejects a LIGHTNING quote', async () => {
    const service = new CashuReceiveQuoteService(fakeCrypto(), fakeRepo());
    await expect(
      service.markMeltInitiated(quote({ type: 'LIGHTNING' }) as never),
    ).rejects.toThrow(/must be of type CASHU_TOKEN/);
  });

  test('getLightningQuote derives the xPub at the base locking path', async () => {
    const crypto = fakeCrypto();
    const service = new CashuReceiveQuoteService(crypto, fakeRepo());
    // A wallet whose createLockedMintQuote is stubbed; getLightningQuote only needs the xPub
    // derivation + the mint call.
    const wallet = {
      createLockedMintQuote: mock(async () => ({
        quote: 'mint1',
        request: 'lnbc1...',
        state: 'UNPAID',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      })),
    };

    // The decodeBolt11 of 'lnbc1...' would fail; stub the mint request to a decodable invoice is
    // out of scope — assert the xPub derivation happened before the mint call.
    await service
      .getLightningQuote({
        // biome-ignore lint/suspicious/noExplicitAny: minimal wallet stub for the xPub-derivation assertion.
        wallet: wallet as any,
        amount: sats(100),
      })
      .catch(() => {
        /* decodeBolt11 on the stub request may throw; we only assert the xPub call below */
      });

    expect(crypto.getXpub).toHaveBeenCalledWith("m/129372'/0'/0'");
  });
});
