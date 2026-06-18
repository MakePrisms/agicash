import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import { MintQuoteState } from '@cashu/cashu-ts';
import { DomainError } from '../../errors';
import type { CashuReceiveQuoteRepositoryServer } from '../../internal/repositories/cashu-receive-quote-repository.server';
import { CashuReceiveQuoteServiceServer } from './cashu-receive-quote-service.server';

const lightningQuote = (state: MintQuoteState) =>
  ({
    mintQuote: { quote: 'mint-quote-1', request: 'lnbc1...', state, expiry: 0 },
    lockingPublicKey: '02abc',
    fullLockingDerivationPath: "m/129372'/0'/0/7",
    expiresAt: '2026-06-18T01:00:00.000Z',
    amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
    description: 'hi',
    paymentHash: 'ph-1',
  }) as never;

describe('CashuReceiveQuoteServiceServer', () => {
  it('creates a LIGHTNING quote when the mint quote is UNPAID', async () => {
    const create = mock(async () => ({ id: 'row-1' }) as never);
    const svc = new CashuReceiveQuoteServiceServer({
      create,
    } as unknown as CashuReceiveQuoteRepositoryServer);

    await svc.createReceiveQuote({
      userId: 'user-1',
      account: { id: 'acc-1', mintUrl: 'https://mint.test' } as never,
      lightningQuote: lightningQuote(MintQuoteState.UNPAID),
      receiveType: 'LIGHTNING',
      userEncryptionPublicKey: 'pub-1',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({
      userId: 'user-1',
      accountId: 'acc-1',
      quoteId: 'mint-quote-1',
      paymentRequest: 'lnbc1...',
      paymentHash: 'ph-1',
      lockingDerivationPath: "m/129372'/0'/0/7",
      receiveType: 'LIGHTNING',
      userEncryptionPublicKey: 'pub-1',
    });
  });

  it('rejects when the mint quote is not UNPAID', async () => {
    const svc = new CashuReceiveQuoteServiceServer({
      create: mock(),
    } as unknown as CashuReceiveQuoteRepositoryServer);
    await expect(
      svc.createReceiveQuote({
        userId: 'user-1',
        account: { id: 'acc-1' } as never,
        lightningQuote: lightningQuote(MintQuoteState.PAID),
        receiveType: 'LIGHTNING',
        userEncryptionPublicKey: 'pub-1',
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
