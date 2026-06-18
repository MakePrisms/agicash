import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import type { SparkReceiveQuoteRepositoryServer } from '../../internal/repositories/spark-receive-quote-repository.server';
import { SparkReceiveQuoteServiceServer } from './spark-receive-quote-service.server';

// A real, decodable bolt11 invoice (from internal/lib/bolt11/index.test.ts).
const INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

describe('SparkReceiveQuoteServiceServer', () => {
  it('getLightningQuote passes receiverIdentityPubkey + descriptionHash to the wallet', async () => {
    const captured: {
      method?: { receiverIdentityPubkey?: string; descriptionHash?: string };
    } = {};
    const wallet = {
      receivePayment: async ({ paymentMethod }: { paymentMethod: unknown }) => {
        captured.method = paymentMethod as never;
        return {
          paymentRequest: INVOICE,
          lightningReceiveDetails: {
            receiveRequestId: 'rr-1',
            status: 'invoiceCreated',
            createdAt: 1_700_000_000,
            updatedAt: 1_700_000_000,
          },
        };
      },
    } as never;
    const svc = new SparkReceiveQuoteServiceServer(
      {} as SparkReceiveQuoteRepositoryServer,
    );

    const quote = await svc.getLightningQuote({
      wallet,
      amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }) as Money,
      receiverIdentityPubkey: 'deadbeef',
      descriptionHash: 'abc123',
    });

    expect(captured.method?.receiverIdentityPubkey).toBe('deadbeef');
    expect(captured.method?.descriptionHash).toBe('abc123');
    expect(quote.receiverIdentityPublicKey).toBe('deadbeef');
  });

  it('createReceiveQuote (LIGHTNING) builds repo params from the lightning quote', async () => {
    const create = mock(async () => ({ id: 'row-1' }) as never);
    const repo = { create } as unknown as SparkReceiveQuoteRepositoryServer;
    const svc = new SparkReceiveQuoteServiceServer(repo);

    const lightningQuote = {
      id: 'rr-1',
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z',
      invoice: {
        paymentRequest: INVOICE,
        paymentHash: 'ph-1',
        amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
        createdAt: '2026-06-18T00:00:00.000Z',
        expiresAt: '2026-06-18T01:00:00.000Z',
        memo: 'hi',
      },
      status: 'invoiceCreated',
      receiverIdentityPublicKey: 'deadbeef',
    } as never;

    await svc.createReceiveQuote({
      userId: 'user-1',
      account: { id: 'acc-1', currency: 'BTC' } as never,
      lightningQuote,
      receiveType: 'LIGHTNING',
      userEncryptionPublicKey: 'pub-1',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({
      userId: 'user-1',
      accountId: 'acc-1',
      paymentRequest: INVOICE,
      paymentHash: 'ph-1',
      sparkId: 'rr-1',
      receiverIdentityPubkey: 'deadbeef',
      receiveType: 'LIGHTNING',
      userEncryptionPublicKey: 'pub-1',
    });
  });
});
