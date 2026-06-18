import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import { ServerSdk } from './server-sdk';

const sat = (n: number) =>
  new Money({ amount: n, currency: 'BTC', unit: 'sat' });

// A real BOLT11 invoice — the cashu create path runs it through `decodeBolt11`
// (via the cashu core `getLightningQuote`), so it must actually decode.
const TEST_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

// A real xpub — the cashu create path derives a NUT-20 locking key from it
// (`HDKey.fromExtendedKey`), so it must be a valid extended public key.
const TEST_XPUB =
  'xpub6C3NoNvapesbJUparkRBHevx9Sqq9bh4uTxfHNXyjRxLQAewJkYoo4RJEhg581gfyQm2qgChbxauRftkH2LddEMBeqxtoUDcL9FetWaakdv';

function makeDeps(overrides: Record<string, unknown> = {}) {
  const user = {
    id: 'user-1',
    username: 'alice',
    cashuLockingXpub: TEST_XPUB,
    encryptionPublicKey: 'enc-pub',
    sparkIdentityPublicKey: 'spark-pub',
    defaultCurrency: 'BTC',
  };
  return {
    lud16Domain: 'agi.cash',
    userRepository: {
      get: mock(async () => user),
      getByUsername: mock(async () => user),
    },
    serverAccountRepository: {
      getDefaultAccount: mock(async () => ({
        id: 'acc-1',
        type: 'cashu',
        currency: 'BTC',
        mintUrl: 'https://mint.test',
        wallet: {
          createLockedMintQuote: async () => ({
            quote: 'mq-1',
            request: TEST_INVOICE,
            state: 'UNPAID',
            expiry: 0,
          }),
        },
      })),
    },
    cashuReceiveQuoteService: {
      createReceiveQuote: mock(async () => ({ id: 'row-1', quoteId: 'mq-1' })),
    },
    sparkReceiveQuoteService: {
      getLightningQuote: mock(async () => ({
        id: 'rr-1',
        invoice: { paymentRequest: 'lnbc-spark' },
      })),
      createReceiveQuote: mock(async () => ({ id: 'row-2' })),
    },
    exchangeRate: {
      convert: mock(async ({ amount }: { amount: Money }) => amount),
    },
    getCashuMintWallet: mock(() => ({
      checkMintQuoteBolt11: async () => ({
        state: 'PAID',
        request: 'lnbc1...',
      }),
    })),
    getServerSparkWallet: mock(async () => ({
      getLightningReceiveRequest: async () => ({
        status: 'transferCompleted',
        invoice: 'lnbc-spark',
        paymentPreimage: 'pre',
      }),
    })),
    ...overrides,
  } as never;
}

describe('ServerSdk', () => {
  it('resolveLightningAddress returns the receiving capability (fixed min/max + metadata)', async () => {
    const sdk = new ServerSdk(makeDeps());
    const info = await sdk.resolveLightningAddress('alice');
    expect(info).toMatchObject({ userId: 'user-1', username: 'alice' });
    expect(info?.minSendable.toNumber('sat')).toBe(1);
    expect(info?.maxSendable.toNumber('sat')).toBe(1_000_000);
    expect(info?.metadata).toContain('alice@agi.cash');
  });

  it('resolveLightningAddress returns null for an unknown username', async () => {
    const deps = makeDeps({
      userRepository: { get: mock(), getByUsername: mock(async () => null) },
    });
    expect(
      await new ServerSdk(deps).resolveLightningAddress('nobody'),
    ).toBeNull();
  });

  it('createLightningReceiveQuote (cashu) mints a locked quote and returns a cashu verify ref', async () => {
    const sdk = new ServerSdk(makeDeps());
    const result = await sdk.createLightningReceiveQuote({
      userId: 'user-1',
      amount: sat(100),
    });
    expect(result.paymentRequest).toBe(TEST_INVOICE);
    expect(result.verify).toEqual({
      type: 'cashu',
      quoteId: 'mq-1',
      mintUrl: 'https://mint.test',
    });
  });

  it('createLightningReceiveQuote persists the quote via the cashu service', async () => {
    const deps = makeDeps();
    const sdk = new ServerSdk(deps);
    await sdk.createLightningReceiveQuote({
      userId: 'user-1',
      amount: sat(100),
    });
    const createReceiveQuote = (
      deps as unknown as {
        cashuReceiveQuoteService: {
          createReceiveQuote: ReturnType<typeof mock>;
        };
      }
    ).cashuReceiveQuoteService.createReceiveQuote;
    expect(createReceiveQuote).toHaveBeenCalledTimes(1);
    expect((createReceiveQuote.mock.calls[0] as unknown[])[0]).toMatchObject({
      userId: 'user-1',
      userEncryptionPublicKey: 'enc-pub',
      receiveType: 'LIGHTNING',
    });
  });

  it('createLightningReceiveQuote rejects an out-of-range amount', async () => {
    const sdk = new ServerSdk(makeDeps());
    await expect(
      sdk.createLightningReceiveQuote({ userId: 'user-1', amount: sat(0) }),
    ).rejects.toMatchObject({ code: 'amount_out_of_range' });
    await expect(
      sdk.createLightningReceiveQuote({
        userId: 'user-1',
        amount: sat(2_000_000),
      }),
    ).rejects.toMatchObject({ code: 'amount_out_of_range' });
  });

  it('createLightningReceiveQuote rejects an unknown user', async () => {
    const deps = makeDeps({
      userRepository: { get: mock(async () => null), getByUsername: mock() },
    });
    await expect(
      new ServerSdk(deps).createLightningReceiveQuote({
        userId: 'ghost',
        amount: sat(100),
      }),
    ).rejects.toMatchObject({ code: 'user_not_found' });
  });

  it('getLightningReceiveStatus (cashu) reports settled for PAID', async () => {
    const sdk = new ServerSdk(makeDeps());
    const status = await sdk.getLightningReceiveStatus({
      type: 'cashu',
      quoteId: 'mq-1',
      mintUrl: 'https://mint.test',
    });
    expect(status).toEqual({
      settled: true,
      preimage: '',
      paymentRequest: 'lnbc1...',
    });
  });

  it('getLightningReceiveStatus (cashu) reports unsettled with null preimage for UNPAID', async () => {
    const deps = makeDeps({
      getCashuMintWallet: mock(() => ({
        checkMintQuoteBolt11: async () => ({
          state: 'UNPAID',
          request: 'lnbc1...',
        }),
      })),
    });
    const status = await new ServerSdk(deps).getLightningReceiveStatus({
      type: 'cashu',
      quoteId: 'mq-1',
      mintUrl: 'https://mint.test',
    });
    expect(status).toEqual({
      settled: false,
      preimage: null,
      paymentRequest: 'lnbc1...',
    });
  });

  it('getLightningReceiveStatus (spark) reports settled for transferCompleted', async () => {
    const sdk = new ServerSdk(makeDeps());
    const status = await sdk.getLightningReceiveStatus({
      type: 'spark',
      quoteId: 'rr-1',
    });
    expect(status).toEqual({
      settled: true,
      preimage: 'pre',
      paymentRequest: 'lnbc-spark',
    });
  });

  it('getLightningReceiveStatus (spark) throws when the request is not found', async () => {
    const deps = makeDeps({
      getServerSparkWallet: mock(async () => ({
        getLightningReceiveRequest: async () => undefined,
      })),
    });
    await expect(
      new ServerSdk(deps).getLightningReceiveStatus({
        type: 'spark',
        quoteId: 'gone',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
