import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { SparkLightningReceiveDbDataSchema } from './spark-receive-quote-db-data';
import { SparkLightningSendDbDataSchema } from './spark-send-quote-db-data';

const btc = (amount: number) =>
  new Money({ amount, currency: 'BTC', unit: 'sat' });

describe('spark db-data schemas parse', () => {
  it('parses lightning-send db data (Money fields survive)', () => {
    const parsed = SparkLightningSendDbDataSchema.parse({
      paymentRequest: 'lnbc1...',
      amountReceived: btc(100),
      estimatedLightningFee: btc(1),
    });
    expect(parsed.amountReceived).toBeInstanceOf(Money);
    expect(parsed.amountReceived.toNumber('sat')).toBe(100);
  });

  it('parses lightning-receive db data (LIGHTNING, no token melt data)', () => {
    const parsed = SparkLightningReceiveDbDataSchema.parse({
      paymentRequest: 'lnbc1...',
      amountReceived: btc(100),
      totalFee: btc(0),
    });
    expect(parsed.amountReceived).toBeInstanceOf(Money);
    expect(parsed.cashuTokenMeltData).toBeUndefined();
  });
});
