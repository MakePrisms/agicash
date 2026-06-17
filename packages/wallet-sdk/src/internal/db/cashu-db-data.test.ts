import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { CashuLightningReceiveDbDataSchema } from './cashu-receive-quote-db-data';
import { CashuSwapReceiveDbDataSchema } from './cashu-receive-swap-db-data';
import { CashuLightningSendDbDataSchema } from './cashu-send-quote-db-data';
import { CashuSwapSendDbDataSchema } from './cashu-send-swap-db-data';
import { CashuTokenMeltDbDataSchema } from './cashu-token-melt-db-data';

const sat = (amount: number) =>
  new Money({ amount, currency: 'BTC', unit: 'sat' });

const proof = {
  id: 'test-keyset-id',
  amount: 100,
  secret: 'test-secret',
  C: 'test-unblinded-sig',
};

describe('cashu db-data schemas parse', () => {
  it('parses lightning-send db data', () => {
    const fixture = {
      paymentRequest: 'lnbc1test',
      amountRequested: sat(1000),
      amountRequestedInMsat: 1000000,
      amountReceived: sat(1000),
      lightningFeeReserve: sat(10),
      cashuSendFee: sat(1),
      meltQuoteId: 'quote-id-abc',
      amountReserved: sat(1011),
    };
    const result = CashuLightningSendDbDataSchema.parse(fixture);
    expect(result.amountRequested).toBeInstanceOf(Money);
    expect(result.amountReceived).toBeInstanceOf(Money);
    expect(result.lightningFeeReserve).toBeInstanceOf(Money);
    expect(result.cashuSendFee).toBeInstanceOf(Money);
    expect(result.amountReserved).toBeInstanceOf(Money);
    expect(result.meltQuoteId).toBe('quote-id-abc');
    expect(result.destinationDetails).toBeUndefined();
    expect(result.paymentPreimage).toBeUndefined();
  });

  it('parses lightning-send db data with optional fields', () => {
    const fixture = {
      paymentRequest: 'lnbc1test',
      amountRequested: sat(1000),
      amountRequestedInMsat: 1000000,
      amountReceived: sat(1000),
      lightningFeeReserve: sat(10),
      cashuSendFee: sat(1),
      meltQuoteId: 'quote-id-abc',
      amountReserved: sat(1011),
      destinationDetails: {
        sendType: 'LN_ADDRESS',
        lnAddress: 'user@wallet.io',
      },
      paymentPreimage: 'aabbccdd',
      amountSpent: sat(1008),
      lightningFee: sat(7),
      totalFee: sat(8),
    };
    const result = CashuLightningSendDbDataSchema.parse(fixture);
    expect(result.amountSpent).toBeInstanceOf(Money);
    expect(result.lightningFee).toBeInstanceOf(Money);
    expect(result.totalFee).toBeInstanceOf(Money);
    expect(result.destinationDetails).toEqual({
      sendType: 'LN_ADDRESS',
      lnAddress: 'user@wallet.io',
    });
  });

  it('parses swap-send db data', () => {
    const fixture = {
      tokenMintUrl: 'https://mint.test',
      amountReceived: sat(900),
      cashuReceiveFee: sat(1),
      amountToSend: sat(901),
      cashuSendFee: sat(1),
      amountSpent: sat(902),
      amountReserved: sat(1024),
      totalFee: sat(2),
    };
    const result = CashuSwapSendDbDataSchema.parse(fixture);
    expect(result.amountReceived).toBeInstanceOf(Money);
    expect(result.cashuReceiveFee).toBeInstanceOf(Money);
    expect(result.amountToSend).toBeInstanceOf(Money);
    expect(result.cashuSendFee).toBeInstanceOf(Money);
    expect(result.amountSpent).toBeInstanceOf(Money);
    expect(result.amountReserved).toBeInstanceOf(Money);
    expect(result.totalFee).toBeInstanceOf(Money);
    expect(result.outputAmounts).toBeUndefined();
  });

  it('parses swap-send db data with outputAmounts', () => {
    const fixture = {
      tokenMintUrl: 'https://mint.test',
      amountReceived: sat(900),
      cashuReceiveFee: sat(1),
      amountToSend: sat(901),
      cashuSendFee: sat(1),
      amountSpent: sat(902),
      amountReserved: sat(1024),
      totalFee: sat(2),
      outputAmounts: { send: [512, 256, 128, 4, 1], change: [123] },
    };
    const result = CashuSwapSendDbDataSchema.parse(fixture);
    expect(result.outputAmounts?.send).toEqual([512, 256, 128, 4, 1]);
    expect(result.outputAmounts?.change).toEqual([123]);
  });

  it('parses token-melt db data', () => {
    const fixture = {
      tokenMintUrl: 'https://mint.test',
      meltQuoteId: 'melt-quote-id',
      tokenAmount: sat(500),
      tokenProofs: [proof],
      cashuReceiveFee: sat(1),
      lightningFeeReserve: sat(10),
    };
    const result = CashuTokenMeltDbDataSchema.parse(fixture);
    expect(result.tokenAmount).toBeInstanceOf(Money);
    expect(result.cashuReceiveFee).toBeInstanceOf(Money);
    expect(result.lightningFeeReserve).toBeInstanceOf(Money);
    expect(result.tokenProofs).toHaveLength(1);
    expect(result.tokenProofs[0].id).toBe('test-keyset-id');
  });

  it('parses lightning-receive db data', () => {
    const fixture = {
      paymentRequest: 'lnbc1receive',
      mintQuoteId: 'mint-quote-id',
      amountReceived: sat(1000),
      totalFee: sat(0),
    };
    const result = CashuLightningReceiveDbDataSchema.parse(fixture);
    expect(result.amountReceived).toBeInstanceOf(Money);
    expect(result.totalFee).toBeInstanceOf(Money);
    expect(result.cashuTokenMeltData).toBeUndefined();
  });

  it('parses lightning-receive db data with cashuTokenMeltData', () => {
    const fixture = {
      paymentRequest: 'lnbc1receive',
      mintQuoteId: 'mint-quote-id',
      amountReceived: sat(500),
      totalFee: sat(11),
      description: 'test payment',
      mintingFee: sat(0),
      outputAmounts: [256, 128, 64, 32, 16, 4],
      cashuTokenMeltData: {
        tokenMintUrl: 'https://other-mint.test',
        meltQuoteId: 'melt-quote-id',
        tokenAmount: sat(500),
        tokenProofs: [proof],
        cashuReceiveFee: sat(1),
        lightningFeeReserve: sat(10),
      },
    };
    const result = CashuLightningReceiveDbDataSchema.parse(fixture);
    expect(result.cashuTokenMeltData?.tokenAmount).toBeInstanceOf(Money);
    expect(result.cashuTokenMeltData?.cashuReceiveFee).toBeInstanceOf(Money);
    expect(result.mintingFee).toBeInstanceOf(Money);
  });

  it('parses swap-receive db data', () => {
    const fixture = {
      tokenMintUrl: 'https://mint.test',
      tokenAmount: sat(500),
      tokenProofs: [proof],
      amountReceived: sat(499),
      outputAmounts: [256, 128, 64, 32, 16, 2, 1],
      cashuReceiveFee: sat(1),
    };
    const result = CashuSwapReceiveDbDataSchema.parse(fixture);
    expect(result.tokenAmount).toBeInstanceOf(Money);
    expect(result.amountReceived).toBeInstanceOf(Money);
    expect(result.cashuReceiveFee).toBeInstanceOf(Money);
    expect(result.tokenProofs).toHaveLength(1);
    expect(result.outputAmounts).toEqual([256, 128, 64, 32, 16, 2, 1]);
    expect(result.tokenDescription).toBeUndefined();
  });
});
