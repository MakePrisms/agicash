import { describe, expect, it, mock } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { DomainError } from '../../errors';
import { TransferService } from './transfer-service';

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

const cashuAccount = (over = {}) =>
  ({
    id: 'src',
    type: 'cashu',
    name: 'Cashu',
    currency: 'BTC',
    wallet: {},
  }) as never;
const sparkAccount = (over = {}) =>
  ({
    id: 'dst',
    type: 'spark',
    name: 'Spark',
    currency: 'BTC',
    wallet: {},
  }) as never;

// cashu send lightning quote (estimatedTotalFee + amountToReceive + the persist payload fields)
const cashuSendQuote = {
  paymentRequest: 'lnbc-x',
  amountRequested: btc(1000),
  amountRequestedInBtc: btc(1000),
  meltQuote: { quote: 'mq' },
  amountToReceive: btc(1000),
  estimatedTotalFee: btc(20),
};
// spark receive lightning quote carries the invoice we quote against
const sparkReceiveQuote = { invoice: { paymentRequest: 'lnbc-x' } };

function services(overrides: Record<string, ReturnType<typeof mock>> = {}) {
  return {
    cashuReceive: {
      getLightningQuote: mock(async () => ({})),
      createReceiveQuote: mock(),
      fail: mock(),
    },
    sparkReceive: {
      createReceiveQuote: mock(async () => ({ transactionId: 'rx-tx' })),
      fail: mock(async () => undefined),
    },
    cashuSend: {
      getLightningQuote: mock(async () => cashuSendQuote),
      createSendQuote: mock(async () => ({ transactionId: 'sx-tx' })),
    },
    sparkSend: { getLightningSendQuote: mock(), createSendQuote: mock() },
    ...overrides,
  };
}

// helper: a cashu(send) → spark(receive) transfer (canSend/canReceive must pass for these fakes)
function build(s: ReturnType<typeof services>) {
  return new TransferService(
    s.cashuReceive as never,
    s.sparkReceive as never,
    s.cashuSend as never,
    s.sparkSend as never,
  );
}

describe('TransferService', () => {
  it('§10 REGRESSION: a send-persist failure fails the already-persisted receive quote and rethrows the ORIGINAL error', async () => {
    const sendError = new Error('persist send failed');
    const receiveQuote = { transactionId: 'rx-tx', id: 'rq1' };
    const s = services();
    s.sparkReceive.createReceiveQuote = mock(async () => receiveQuote);
    s.cashuSend.createSendQuote = mock(async () => {
      throw sendError;
    });
    const service = build(s);

    const quote = {
      amount: btc(1000),
      amountToReceive: btc(1000),
      totalFees: btc(20),
      totalCost: btc(1020),
      receive: {
        account: sparkAccount(),
        fee: btc(0),
        lightningQuote: sparkReceiveQuote,
      },
      send: { account: cashuAccount(), lightningQuote: cashuSendQuote },
    } as never;

    await expect(
      service.initiateTransfer({ userId: 'u1', quote }),
    ).rejects.toBe(sendError);
    // the receive quote was failed (compensating action), with the fixed reason string
    expect(s.sparkReceive.fail).toHaveBeenCalledWith(
      receiveQuote,
      'Transfer initiation failed',
    );
  });

  it('§10: a cleanup (fail) error is swallowed; the ORIGINAL send error still propagates', async () => {
    const sendError = new Error('persist send failed');
    const s = services();
    s.sparkReceive.createReceiveQuote = mock(async () => ({
      transactionId: 'rx',
      id: 'rq',
    }));
    s.cashuSend.createSendQuote = mock(async () => {
      throw sendError;
    });
    s.sparkReceive.fail = mock(async () => {
      throw new Error('cleanup blew up');
    });
    const service = build(s);
    const quote = {
      amount: btc(1000),
      amountToReceive: btc(1000),
      totalFees: btc(20),
      totalCost: btc(1020),
      receive: {
        account: sparkAccount(),
        fee: btc(0),
        lightningQuote: sparkReceiveQuote,
      },
      send: { account: cashuAccount(), lightningQuote: cashuSendQuote },
    } as never;

    await expect(
      service.initiateTransfer({ userId: 'u1', quote }),
    ).rejects.toBe(sendError);
  });

  it('happy path persists receive then send and returns all three ids', async () => {
    const s = services();
    s.sparkReceive.createReceiveQuote = mock(async () => ({
      transactionId: 'rx-tx',
    }));
    s.cashuSend.createSendQuote = mock(async () => ({
      transactionId: 'sx-tx',
    }));
    const service = build(s);
    const quote = {
      amount: btc(1000),
      amountToReceive: btc(1000),
      totalFees: btc(20),
      totalCost: btc(1020),
      receive: {
        account: sparkAccount(),
        fee: btc(0),
        lightningQuote: sparkReceiveQuote,
      },
      send: { account: cashuAccount(), lightningQuote: cashuSendQuote },
    } as never;

    const result = await service.initiateTransfer({ userId: 'u1', quote });
    expect(result.receiveTransactionId).toBe('rx-tx');
    expect(result.sendTransactionId).toBe('sx-tx');
    expect(typeof result.transferId).toBe('string');
    expect(s.sparkReceive.fail).not.toHaveBeenCalled();
  });

  it('getTransferQuote throws a DomainError when the source cannot send Lightning', async () => {
    const service = build(services());
    // a test-mint cashu account cannot send to lightning; use a shape canSendToLightning rejects.
    const badSource = {
      id: 's',
      type: 'cashu',
      name: 'Test',
      currency: 'BTC',
      isTestMint: true,
    } as never;
    await expect(
      service.getTransferQuote({
        sourceAccount: badSource,
        destinationAccount: sparkAccount(),
        amount: btc(1000),
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
