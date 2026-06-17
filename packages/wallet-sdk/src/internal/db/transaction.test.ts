import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { TransactionSchema } from './transaction';

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

const baseFields = {
  id: 't1',
  userId: 'u1',
  accountId: 'a1',
  accountName: 'Spark',
  accountType: 'spark' as const,
  accountPurpose: 'transactional' as const,
  reversedTransactionId: null,
  acknowledgmentStatus: null,
  createdAt: '2024-01-01T00:00:00Z',
  pendingAt: null,
  completedAt: null,
  failedAt: null,
  reversedAt: null,
  version: 1,
};

const sparkReceiveDetails = {
  paymentRequest: 'lnbc1',
  paymentHash: 'ph',
  sparkId: 'sid',
  amount: btc(1000),
};

describe('TransactionSchema', () => {
  it('parses a PAYMENT spark lightning receive', () => {
    const tx = TransactionSchema.parse({
      ...baseFields,
      direction: 'RECEIVE',
      type: 'SPARK_LIGHTNING',
      state: 'PENDING',
      purpose: 'PAYMENT',
      amount: btc(1000),
      details: sparkReceiveDetails,
    });
    expect(tx.purpose).toBe('PAYMENT');
    expect(tx.amount.toNumber('sat')).toBe(1000);
  });

  it('parses a TRANSFER leg (details narrows to { transferId })', () => {
    const tx = TransactionSchema.parse({
      ...baseFields,
      direction: 'RECEIVE',
      type: 'SPARK_LIGHTNING',
      state: 'PENDING',
      purpose: 'TRANSFER',
      amount: btc(1000),
      details: { ...sparkReceiveDetails, transferId: 'xfer-1' },
    });
    expect(tx.purpose).toBe('TRANSFER');
    expect((tx.details as { transferId: string }).transferId).toBe('xfer-1');
  });
});
