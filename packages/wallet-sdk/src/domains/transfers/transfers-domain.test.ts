import { describe, expect, it, mock } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../../internal/event-emitter';
import { inMemoryStorage, jwtWith } from '../../internal/test-support';
import type { DomainContext } from '../context';
import { createTransfersDomain } from './transfers-domain';

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;
const cashu = { id: 'src', type: 'cashu', currency: 'BTC' } as never;
const spark = { id: 'dst', type: 'spark', currency: 'BTC' } as never;

const richQuote = {
  amount: btc(1000),
  amountToReceive: btc(1000),
  totalFees: btc(20),
  totalCost: btc(1020),
  receive: {
    account: spark,
    fee: btc(0),
    lightningQuote: { invoice: { paymentRequest: 'x' } },
  },
  send: {
    account: cashu,
    lightningQuote: { estimatedTotalFee: btc(20), amountToReceive: btc(1000) },
  },
};

function setup() {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const storage = inMemoryStorage({ access_token: jwtWith({ sub: 'u1' }) });
  const ctx = {
    config: { storage },
    connections: { supabase: {}, encryption: {}, cashuCrypto: {} },
    emitter,
  } as unknown as DomainContext;
  const service = {
    getTransferQuote: mock(async () => richQuote),
    initiateTransfer: mock(async () => ({
      transferId: 'xfer',
      receiveTransactionId: 'rx',
      sendTransactionId: 'sx',
    })),
  };
  return { ctx, service };
}

describe('createTransfersDomain', () => {
  it('createQuote maps the rich quote to the slim contract shape (legs = { account, fee })', async () => {
    const { ctx, service } = setup();
    const domain = createTransfersDomain(ctx, service as never);

    const amount = btc(1000);
    const quote = await domain.createQuote({
      sourceAccount: cashu,
      destinationAccount: spark,
      amount,
    });
    expect(quote.totalCost.toNumber('sat')).toBe(1020);
    // Use the same Money references from richQuote to satisfy bun's deep-equality
    // (Money instance methods are own-properties, so two btc(20) calls create
    // different function references that toEqual would reject).
    expect(quote.send).toEqual({
      account: cashu,
      fee: richQuote.send.lightningQuote.estimatedTotalFee,
    });
    expect(quote.receive).toEqual({
      account: spark,
      fee: richQuote.receive.fee,
    });
    expect('lightningQuote' in quote.send).toBe(false);
  });

  it('executeQuote re-derives the live sides then initiates the transfer', async () => {
    const { ctx, service } = setup();
    const domain = createTransfersDomain(ctx, service as never);

    const amount = btc(1000);
    const slimQuote = {
      amount,
      amountToReceive: btc(1000),
      totalFees: btc(20),
      totalCost: btc(1020),
      receive: { account: spark, fee: btc(0) },
      send: { account: cashu, fee: btc(20) },
    };
    const result = await domain.executeQuote(slimQuote);

    expect(service.getTransferQuote).toHaveBeenCalledWith({
      sourceAccount: cashu,
      destinationAccount: spark,
      amount,
    });
    expect(service.initiateTransfer).toHaveBeenCalledWith({
      userId: 'u1',
      quote: richQuote,
    });
    expect(result).toEqual({
      transferId: 'xfer',
      receiveTransactionId: 'rx',
      sendTransactionId: 'sx',
    });
  });
});
