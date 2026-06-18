import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { SdkError } from '../../errors';
import {
  type CreateQuoteBaseParams,
  type SparkReceiveLightningQuote,
  computeQuoteExpiry,
  getAmountAndFee,
  getLightningQuote,
} from './spark-receive-quote-core';

// Real, decodable bolt11 invoice from internal/lib/bolt11/index.test.ts
// amountMsat: 250_000_000, createdAt: 1496314658, expiry: 1496314718
const INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

type CapturedPaymentMethod = {
  type: string;
  description: string;
  amountSats: number;
  receiverIdentityPubkey?: string;
  descriptionHash?: string;
};

function fakeWallet(captured: { method?: CapturedPaymentMethod }) {
  return {
    receivePayment: async ({
      paymentMethod,
    }: {
      paymentMethod: CapturedPaymentMethod;
    }) => {
      captured.method = paymentMethod;
      return {
        paymentRequest: INVOICE,
        fee: 0n,
        lightningReceiveDetails: {
          receiveRequestId: 'rr_1',
          status: 'invoiceCreated' as const,
          createdAt: 1_700_000_000,
          updatedAt: 1_700_000_001,
        },
      };
    },
  } as never;
}

const btcSat = (amount: number): Money<Currency> =>
  new Money({
    amount,
    currency: 'BTC',
    unit: 'sat',
  }) as unknown as Money<Currency>;

/** Build a minimal SparkReceiveLightningQuote fixture for pure-function tests. */
function makeQuote(expiresAt: string): SparkReceiveLightningQuote {
  return {
    id: 'q1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    invoice: {
      paymentRequest: INVOICE,
      paymentHash: 'aabbcc',
      amount: new Money({
        amount: 200,
        currency: 'BTC',
        unit: 'sat',
      }) as unknown as SparkReceiveLightningQuote['invoice']['amount'],
      createdAt: '2024-01-01T00:00:00.000Z',
      expiresAt,
    },
    status: 'invoiceCreated',
  };
}

describe('getLightningQuote', () => {
  it('returns a quote (client path, no receiverIdentityPubkey)', async () => {
    const captured: { method?: CapturedPaymentMethod } = {};
    const amount = btcSat(100);
    const quote = await getLightningQuote({
      wallet: fakeWallet(captured) as never,
      amount,
    });

    expect(captured.method?.amountSats).toBe(100);
    expect(quote.invoice.paymentRequest).toBe(INVOICE);
    expect(quote.receiverIdentityPublicKey).toBeUndefined();
    expect(quote.id).toBe('rr_1');
    // invoice amount comes from decoded amountMsat (250_000_000 msat)
    expect(quote.invoice.amount.toNumber('msat')).toBe(250_000_000);
  });

  it('passes receiverIdentityPubkey through and surfaces it on the quote (D6-2 server-readiness)', async () => {
    const captured: { method?: CapturedPaymentMethod } = {};
    const quote = await getLightningQuote({
      wallet: fakeWallet(captured) as never,
      amount: btcSat(100),
      receiverIdentityPubkey: 'deadbeef',
    });

    expect(captured.method?.receiverIdentityPubkey).toBe('deadbeef');
    expect(quote.receiverIdentityPublicKey).toBe('deadbeef');
  });

  it('throws SdkError when receivePayment returns an invalid bolt11', async () => {
    const badWallet = {
      receivePayment: async () => ({
        paymentRequest: 'not-a-valid-invoice',
        fee: 0n,
        lightningReceiveDetails: {
          receiveRequestId: 'rr_2',
          status: 'invoiceCreated',
          createdAt: 1_700_000_000,
          updatedAt: 1_700_000_001,
        },
      }),
    } as never;

    await expect(
      getLightningQuote({ wallet: badWallet, amount: btcSat(100) }),
    ).rejects.toBeInstanceOf(SdkError);
    await expect(
      getLightningQuote({ wallet: badWallet, amount: btcSat(100) }),
    ).rejects.toMatchObject({ code: 'spark_unexpected_response' });
  });

  it('throws SdkError when lightningReceiveDetails is absent', async () => {
    const noDetailsWallet = {
      receivePayment: async () => ({
        paymentRequest: INVOICE,
        fee: 0n,
        lightningReceiveDetails: undefined,
      }),
    } as never;

    await expect(
      getLightningQuote({ wallet: noDetailsWallet, amount: btcSat(100) }),
    ).rejects.toBeInstanceOf(SdkError);
    await expect(
      getLightningQuote({ wallet: noDetailsWallet, amount: btcSat(100) }),
    ).rejects.toMatchObject({ code: 'spark_unexpected_response' });
  });

  it('uses the requested amount when the invoice encodes an amount (smoke: amountSats is passed)', async () => {
    const captured: { method?: CapturedPaymentMethod } = {};
    const amount = btcSat(250_000);
    await getLightningQuote({ wallet: fakeWallet(captured) as never, amount });
    expect(captured.method?.amountSats).toBe(250_000);
  });
});

describe('computeQuoteExpiry', () => {
  it('LIGHTNING → returns invoice expiresAt', () => {
    const params: CreateQuoteBaseParams = {
      userId: 'u1',
      account: {} as never,
      lightningQuote: makeQuote('2024-01-01T01:00:00.000Z'),
      receiveType: 'LIGHTNING',
    };
    expect(computeQuoteExpiry(params)).toBe('2024-01-01T01:00:00.000Z');
  });

  it('CASHU_TOKEN → returns invoice expiry when invoice expires first', () => {
    const params: CreateQuoteBaseParams = {
      userId: 'u1',
      account: {} as never,
      lightningQuote: makeQuote('2024-01-01T01:00:00.000Z'),
      receiveType: 'CASHU_TOKEN',
      tokenAmount: btcSat(90),
      sourceMintUrl: 'https://mint.example',
      tokenProofs: [],
      meltQuoteId: 'mq1',
      meltQuoteExpiresAt: '2024-01-01T02:00:00.000Z', // later than invoice
      cashuReceiveFee: btcSat(1),
      lightningFeeReserve: btcSat(2),
    };
    expect(computeQuoteExpiry(params)).toBe('2024-01-01T01:00:00.000Z');
  });

  it('CASHU_TOKEN → returns melt quote expiry when melt quote expires first', () => {
    const params: CreateQuoteBaseParams = {
      userId: 'u1',
      account: {} as never,
      lightningQuote: makeQuote('2024-01-01T01:00:00.000Z'),
      receiveType: 'CASHU_TOKEN',
      tokenAmount: btcSat(90),
      sourceMintUrl: 'https://mint.example',
      tokenProofs: [],
      meltQuoteId: 'mq1',
      meltQuoteExpiresAt: '2024-01-01T00:30:00.000Z', // earlier than invoice
      cashuReceiveFee: btcSat(1),
      lightningFeeReserve: btcSat(2),
    };
    expect(computeQuoteExpiry(params)).toBe('2024-01-01T00:30:00.000Z');
  });
});

describe('getAmountAndFee', () => {
  it('LIGHTNING → totalFee is zero', () => {
    const params: CreateQuoteBaseParams = {
      userId: 'u1',
      account: {} as never,
      lightningQuote: makeQuote('2024-01-01T01:00:00.000Z'),
      receiveType: 'LIGHTNING',
    };
    const { amount, totalFee } = getAmountAndFee(params);
    expect(amount.toNumber('sat')).toBe(200);
    expect(totalFee.toNumber('sat')).toBe(0);
  });

  it('CASHU_TOKEN → totalFee = cashuReceiveFee + lightningFeeReserve', () => {
    const params: CreateQuoteBaseParams = {
      userId: 'u1',
      account: {} as never,
      lightningQuote: makeQuote('2024-01-01T01:00:00.000Z'),
      receiveType: 'CASHU_TOKEN',
      tokenAmount: btcSat(200),
      sourceMintUrl: 'https://mint.example',
      tokenProofs: [],
      meltQuoteId: 'mq1',
      meltQuoteExpiresAt: '2024-01-01T01:00:00.000Z',
      cashuReceiveFee: btcSat(3),
      lightningFeeReserve: btcSat(5),
    };
    const { amount, totalFee } = getAmountAndFee(params);
    expect(amount.toNumber('sat')).toBe(200);
    expect(totalFee.toNumber('sat')).toBe(8); // 3 + 5
  });
});
