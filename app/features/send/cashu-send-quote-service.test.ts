import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from 'bun:test';
import type { CashuAccount } from '~/features/accounts/account';
import { Money } from '~/lib/money';
import { CashuSendQuoteService } from './cashu-send-quote-service';

const amountlessInvoice =
  'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w';

const amountedInvoice =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

const fakeProof = {
  id: 'p1',
  accountId: 'acc1',
  userId: 'user1',
  keysetId: 'k1',
  amount: 1000,
  secret: 'secret-1',
  unblindedSignature: '0x',
  publicKeyY: '0x',
  dleq: null,
  witness: null,
  state: 'unspent',
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  reservedAt: null,
};

const buildAccount = (
  createMeltQuoteBolt11: ReturnType<typeof mock>,
): CashuAccount => {
  const wallet = {
    createMeltQuoteBolt11,
    selectProofsToSend: () => ({
      send: [{ secret: 'secret-1', amount: 1000 }],
    }),
    getFeesForProofs: () => 0,
  };
  return {
    id: 'acc1',
    name: 'test',
    type: 'cashu',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency: 'BTC',
    createdAt: '2026-01-01T00:00:00Z',
    version: 1,
    expiresAt: null,
    mintUrl: 'https://test.mint',
    isTestMint: false,
    keysetCounters: {},
    proofs: [fakeProof] as never,
    wallet: wallet as never,
  };
};

const meltQuoteResponse = {
  quote: 'q1',
  amount: 100,
  fee_reserve: 5,
  state: 'UNPAID',
  expiry: Math.floor(Date.now() / 1000) + 3600,
  request: '',
  unit: 'sat',
};

describe('CashuSendQuoteService.getLightningQuote', () => {
  beforeEach(() => {
    // The bolt11 test invoices are from 2017 (created 2017-06-01T10:57:38Z).
    // The amounted variant has a 60-second expiry, so pin the clock just
    // after creation so the service's expiry check does not flag it.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2017-06-01T10:58:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('passes amountInMsat when invoice is amountless + user supplies amount', async () => {
    const createMeltQuoteBolt11 = mock(async () => meltQuoteResponse);
    const account = buildAccount(createMeltQuoteBolt11);
    const service = new CashuSendQuoteService({
      // Repository is unused on this code path.
      create: () => null,
    } as never);

    await service.getLightningQuote({
      account,
      paymentRequest: amountlessInvoice,
      amount: new Money<'BTC'>({
        amount: 100,
        currency: 'BTC',
        unit: 'sat',
      }) as Money,
    });

    expect(createMeltQuoteBolt11).toHaveBeenCalledTimes(1);
    expect(createMeltQuoteBolt11).toHaveBeenCalledWith(
      amountlessInvoice,
      100_000, // 100 sat → 100_000 msat
    );
  });

  test('does NOT pass amountInMsat when invoice already has an amount', async () => {
    const createMeltQuoteBolt11 = mock(async () => meltQuoteResponse);
    const account = buildAccount(createMeltQuoteBolt11);
    const service = new CashuSendQuoteService({
      create: () => null,
    } as never);

    await service.getLightningQuote({
      account,
      paymentRequest: amountedInvoice,
    });

    expect(createMeltQuoteBolt11).toHaveBeenCalledTimes(1);
    expect(createMeltQuoteBolt11).toHaveBeenCalledWith(amountedInvoice);
  });
});
