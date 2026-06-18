import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { CashuLightningReceiveDbDataSchema } from '../cashu-receive-quote-db-data';
import { CashuLightningSendDbDataSchema } from '../cashu-send-quote-db-data';
import { CashuSwapSendDbDataSchema } from '../cashu-send-swap-db-data';
import { SparkLightningReceiveDbDataSchema } from '../spark-receive-quote-db-data';
import { SparkLightningSendDbDataSchema } from '../spark-send-quote-db-data';
import { TransactionDetailsParser } from './transaction-details-parser';

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

describe('TransactionDetailsParser', () => {
  it('cashu lightning send: incomplete derives amount=amountReserved + estimatedTotalFee', () => {
    const decryptedTransactionDetails = CashuLightningSendDbDataSchema.parse({
      paymentRequest: 'lnbc1',
      amountRequested: btc(1000),
      amountRequestedInMsat: 10_000_000,
      amountReceived: btc(1000),
      lightningFeeReserve: btc(80),
      cashuSendFee: btc(20),
      meltQuoteId: 'mq1',
      amountReserved: btc(1100),
    });
    const details = TransactionDetailsParser.parse({
      type: 'CASHU_LIGHTNING',
      direction: 'SEND',
      state: 'PENDING',
      transactionDetails: { paymentHash: 'ph1' },
      decryptedTransactionDetails,
    });
    expect(details.amount.toNumber('sat')).toBe(1100);
    expect(
      (details as { estimatedTotalFee: Money }).estimatedTotalFee.toNumber(
        'sat',
      ),
    ).toBe(100);
    expect((details as { paymentHash: string }).paymentHash).toBe('ph1');
  });

  it('cashu lightning send: completed overrides amount=amountSpent + preimage/lightningFee/totalFee', () => {
    const decryptedTransactionDetails = CashuLightningSendDbDataSchema.parse({
      paymentRequest: 'lnbc1',
      amountRequested: btc(1000),
      amountRequestedInMsat: 10_000_000,
      amountReceived: btc(1000),
      lightningFeeReserve: btc(80),
      cashuSendFee: btc(20),
      meltQuoteId: 'mq1',
      amountReserved: btc(1100),
      amountSpent: btc(1030),
      paymentPreimage: 'pre',
      lightningFee: btc(10),
      totalFee: btc(30),
    });
    const details = TransactionDetailsParser.parse({
      type: 'CASHU_LIGHTNING',
      direction: 'SEND',
      state: 'COMPLETED',
      transactionDetails: { paymentHash: 'ph1' },
      decryptedTransactionDetails,
    });
    expect(details.amount.toNumber('sat')).toBe(1030);
    expect((details as { preimage: string }).preimage).toBe('pre');
    expect((details as { totalFee: Money }).totalFee.toNumber('sat')).toBe(30);
  });

  it('cashu lightning receive: maps amount + totalFee', () => {
    const decryptedTransactionDetails = CashuLightningReceiveDbDataSchema.parse(
      {
        paymentRequest: 'lnbc2',
        mintQuoteId: 'mq1',
        amountReceived: btc(2000),
        totalFee: btc(0),
      },
    );
    const details = TransactionDetailsParser.parse({
      type: 'CASHU_LIGHTNING',
      direction: 'RECEIVE',
      state: 'COMPLETED',
      transactionDetails: { paymentHash: 'ph2' },
      decryptedTransactionDetails,
    });
    expect(details.amount.toNumber('sat')).toBe(2000);
    expect((details as { paymentHash: string }).paymentHash).toBe('ph2');
  });

  it('cashu token send: maps tokenAmount + fees', () => {
    const decryptedTransactionDetails = CashuSwapSendDbDataSchema.parse({
      tokenMintUrl: 'https://mint',
      amountToSend: btc(1000),
      amountReceived: btc(950),
      cashuReceiveFee: btc(50),
      cashuSendFee: btc(0),
      amountSpent: btc(1000),
      amountReserved: btc(1000),
      totalFee: btc(50),
    });
    const details = TransactionDetailsParser.parse({
      type: 'CASHU_TOKEN',
      direction: 'SEND',
      state: 'PENDING',
      transactionDetails: undefined,
      decryptedTransactionDetails,
    });
    expect((details as { tokenMintUrl: string }).tokenMintUrl).toBe(
      'https://mint',
    );
  });

  it('cashu token receive (cross-mint via lightning): reads cashuTokenMeltData', () => {
    const decryptedTransactionDetails = CashuLightningReceiveDbDataSchema.parse(
      {
        paymentRequest: 'lnbc3',
        mintQuoteId: 'mq2',
        amountReceived: btc(800),
        totalFee: btc(20),
        cashuTokenMeltData: {
          tokenAmount: btc(820),
          tokenMintUrl: 'https://source-mint',
          meltQuoteId: 'mq-melt',
          cashuReceiveFee: btc(5),
          lightningFeeReserve: btc(15),
          tokenProofs: [],
        },
      },
    );
    const details = TransactionDetailsParser.parse({
      type: 'CASHU_TOKEN',
      direction: 'RECEIVE',
      state: 'PENDING',
      transactionDetails: undefined,
      decryptedTransactionDetails,
    });
    expect((details as { tokenMintUrl: string }).tokenMintUrl).toBe(
      'https://source-mint',
    );
    expect(
      (details as { tokenAmount: Money }).tokenAmount.toNumber('sat'),
    ).toBe(820);
  });

  it('spark lightning send + receive: round-trip a representative fixture each', () => {
    const sendDetails = TransactionDetailsParser.parse({
      type: 'SPARK_LIGHTNING',
      direction: 'SEND',
      state: 'PENDING',
      transactionDetails: { paymentHash: 'sph' },
      decryptedTransactionDetails: SparkLightningSendDbDataSchema.parse({
        paymentRequest: 'lnbc4',
        amountReceived: btc(500),
        estimatedLightningFee: btc(10),
      }),
    });
    expect(sendDetails.amount.toNumber('sat')).toBe(510);

    const receiveDetails = TransactionDetailsParser.parse({
      type: 'SPARK_LIGHTNING',
      direction: 'RECEIVE',
      state: 'PENDING',
      transactionDetails: { paymentHash: 'rph', sparkId: 'sid' },
      decryptedTransactionDetails: SparkLightningReceiveDbDataSchema.parse({
        paymentRequest: 'lnbc5',
        amountReceived: btc(700),
        totalFee: btc(0),
      }),
    });
    expect(receiveDetails.amount.toNumber('sat')).toBe(700);
  });
});
