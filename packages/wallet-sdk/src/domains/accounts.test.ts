import { describe, expect, mock, test } from 'bun:test';
import { AccountsDomainImpl } from './accounts';
import type { AccountRepository } from '../internal/account-repository';
import type { SessionResolver } from '../internal/session';
import type { UserRepository } from '../internal/user-repository';
import { QueryClient } from '../query';
import type { Account, CashuAccount } from '../types/account';
import { type Currency, Money } from '../types/money';
import type { Query } from '../types/query';
import type { PaymentIntent } from '../types/scan';
import type { User } from '../types/user';

// -- Fakes -------------------------------------------------------------------

const baseUser: User = {
  id: 'user-1',
  username: 'alice',
  isGuest: false,
  email: 'alice@example.com',
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  defaultBtcAccountId: 'btc-default',
  defaultUsdAccountId: 'usd-default',
  defaultCurrency: 'BTC',
  cashuLockingXpub: 'xpub',
  encryptionPublicKey: 'enc',
  sparkIdentityPublicKey: 'spark',
  termsAcceptedAt: null,
  giftCardMintTermsAcceptedAt: null,
};

function cashuAccount(opts: {
  id: string;
  sats?: number;
  currency?: 'BTC' | 'USD';
  isOnline?: boolean;
}): CashuAccount {
  return {
    id: opts.id,
    name: opts.id,
    type: 'cashu',
    purpose: 'transactional',
    state: 'active',
    isOnline: opts.isOnline ?? true,
    currency: opts.currency ?? 'BTC',
    createdAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    expiresAt: null,
    mintUrl: `https://${opts.id}.example.com`,
    isTestMint: false,
    keysetCounters: {},
    proofs:
      opts.sats && opts.sats > 0
        ? ([{ amount: opts.sats }] as unknown as CashuAccount['proofs'])
        : [],
    wallet: {} as never,
  };
}

/** A fresh QueryClient per domain (the SDK-internal one in production). */
function makeClient(): QueryClient {
  return new QueryClient();
}

/** Resolve the first emitted value of a `Query`, then unsubscribe. */
function firstEmit<T>(q: Query<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const off = q.subscribe(
      (data) => {
        off();
        resolve(data);
      },
      (err) => {
        off();
        reject(err);
      },
    );
  });
}

/** Build the domain over fakes. Each repo/session method is a `mock` so calls are assertable. */
function buildDomain(overrides?: {
  user?: User | null;
  accounts?: Account[];
  getById?: (id: string) => Account | null;
}) {
  const user = overrides?.user === undefined ? baseUser : overrides.user;
  const accounts = overrides?.accounts ?? [];

  const getAllActive = mock(async () => accounts);
  const getById = mock(async (id: string) =>
    overrides?.getById
      ? overrides.getById(id)
      : (accounts.find((a) => a.id === id) ?? null),
  );
  const add = mock(async (_userId: string, _config: unknown) =>
    cashuAccount({ id: 'new-account' }),
  );
  const accountRepo = {
    getAllActive,
    get: getById,
    add,
  } as unknown as AccountRepository;

  const setDefaultAccount = mock(async () => baseUser);
  const userRepo = { setDefaultAccount } as unknown as UserRepository;

  const session = {
    requireCurrentUser: async () => {
      if (!user) throw new Error('No authenticated user');
      return user;
    },
    getCurrentUser: async () => user,
  } as unknown as SessionResolver;

  const domain = new AccountsDomainImpl(
    makeClient(),
    accountRepo,
    userRepo,
    session,
  );
  return { domain, getAllActive, getById, add, setDefaultAccount };
}

describe('AccountsDomainImpl.list (observable read → Query)', () => {
  test('returns a Query whose toPromise() resolves to active accounts sorted oldest-first', async () => {
    const a = cashuAccount({ id: 'a' });
    a.createdAt = '2026-03-01T00:00:00.000Z';
    const b = cashuAccount({ id: 'b' });
    b.createdAt = '2026-01-01T00:00:00.000Z';
    const { domain } = buildDomain({ accounts: [a, b] });

    const query = domain.list();
    // It is a Query<Account[]>, not a bare Promise.
    expect(typeof query.subscribe).toBe('function');
    expect(typeof query.toPromise).toBe('function');
    expect(typeof query.getSnapshot).toBe('function');

    const result = await query.toPromise();
    expect(result.map((x) => x.id)).toEqual(['b', 'a']);
  });

  test('subscribe fires with the resolved accounts', async () => {
    const a = cashuAccount({ id: 'a' });
    const { domain } = buildDomain({ accounts: [a] });

    const emitted = await firstEmit(domain.list());
    expect(emitted.map((x) => x.id)).toEqual(['a']);
  });

  test('is memoised — repeated calls return the SAME Query ref', () => {
    const { domain } = buildDomain({ accounts: [] });
    expect(domain.list()).toBe(domain.list());
  });
});

describe('AccountsDomainImpl.get (observable read → Query)', () => {
  test('returns a Query that resolves to the account from the repository', async () => {
    const a = cashuAccount({ id: 'a' });
    const { domain, getById } = buildDomain({ accounts: [a] });

    const query = domain.get('a');
    expect(typeof query.subscribe).toBe('function');
    expect((await query.toPromise())?.id).toBe('a');
    expect(getById).toHaveBeenCalledWith('a');
  });

  test('resolves to null for a missing id', async () => {
    const { domain } = buildDomain({ accounts: [] });
    expect(await domain.get('missing').toPromise()).toBeNull();
  });

  test('memoises one Query per id (same id → same ref, different id → different ref)', () => {
    const { domain } = buildDomain({ accounts: [] });
    expect(domain.get('a')).toBe(domain.get('a'));
    expect(domain.get('a')).not.toBe(domain.get('b'));
  });
});

describe('AccountsDomainImpl.getDefault (observable read → Query)', () => {
  test('reads the BTC default by default currency', async () => {
    const def = cashuAccount({ id: 'btc-default' });
    const { domain } = buildDomain({
      accounts: [def],
      getById: (id) => (id === 'btc-default' ? def : null),
    });

    const result = await domain.getDefault().toPromise();
    expect(result?.id).toBe('btc-default');
  });

  test('reads the USD default when currency=USD', async () => {
    const def = cashuAccount({ id: 'usd-default', currency: 'USD' });
    const { domain, getById } = buildDomain({
      getById: (id) => (id === 'usd-default' ? def : null),
    });

    const result = await domain.getDefault({ currency: 'USD' }).toPromise();
    expect(result?.id).toBe('usd-default');
    expect(getById).toHaveBeenCalledWith('usd-default');
  });

  test('resolves to null when no default id is set for the currency', async () => {
    const userNoUsd: User = { ...baseUser, defaultUsdAccountId: null };
    const { domain } = buildDomain({ user: userNoUsd });

    expect(await domain.getDefault({ currency: 'USD' }).toPromise()).toBeNull();
  });

  test('memoises one Query per currency', () => {
    const { domain } = buildDomain({ accounts: [] });
    expect(domain.getDefault({ currency: 'BTC' })).toBe(
      domain.getDefault({ currency: 'BTC' }),
    );
    expect(domain.getDefault({ currency: 'BTC' })).not.toBe(
      domain.getDefault({ currency: 'USD' }),
    );
  });
});

describe('AccountsDomainImpl.add (write → Promise)', () => {
  test('resolves the user id and delegates to the repository', async () => {
    const { domain, add } = buildDomain();

    const account = await domain.add({
      type: 'cashu',
      mintUrl: 'https://m.example.com',
      currency: 'BTC',
    });
    expect(account.id).toBe('new-account');
    expect(add).toHaveBeenCalledWith('user-1', {
      type: 'cashu',
      mintUrl: 'https://m.example.com',
      currency: 'BTC',
    });
  });
});

describe('AccountsDomainImpl.setDefault (write → Promise)', () => {
  test('sets the BTC default, leaving the USD default untouched', async () => {
    const account = cashuAccount({ id: 'new-btc', currency: 'BTC' });
    const { domain, setDefaultAccount } = buildDomain();

    await domain.setDefault(account);
    expect(setDefaultAccount).toHaveBeenCalledWith('user-1', {
      defaultBtcAccountId: 'new-btc',
      defaultUsdAccountId: 'usd-default',
      defaultCurrency: 'BTC',
    });
  });

  test('sets the USD default, leaving the BTC default untouched', async () => {
    const account = cashuAccount({ id: 'new-usd', currency: 'USD' });
    const { domain, setDefaultAccount } = buildDomain();

    await domain.setDefault(account);
    expect(setDefaultAccount).toHaveBeenCalledWith('user-1', {
      defaultBtcAccountId: 'btc-default',
      defaultUsdAccountId: 'new-usd',
      defaultCurrency: 'BTC',
    });
  });

  test('rejects an unsupported currency', async () => {
    const account = {
      ...cashuAccount({ id: 'x' }),
      currency: 'EUR',
    } as unknown as Account;
    const { domain } = buildDomain();

    await expect(domain.setDefault(account)).rejects.toThrow(
      'Unsupported currency',
    );
  });
});

describe('AccountsDomainImpl.getBalance (pure derivation → SYNC)', () => {
  test('returns the cashu proof sum as Money DIRECTLY (not a Query)', () => {
    const { domain } = buildDomain();
    const account = cashuAccount({ id: 'a', sats: 4200 });

    const balance = domain.getBalance(account);
    // SYNC: a Money value, not a Query (no subscribe/toPromise).
    expect(balance).toBeInstanceOf(Money);
    expect(balance.toNumber('sat')).toBe(4200);
  });

  test('returns Money.zero for a spark account with a null balance', () => {
    const { domain } = buildDomain();
    const spark = {
      type: 'spark',
      currency: 'BTC',
      balance: null,
    } as unknown as Account;

    const balance = domain.getBalance(spark);
    expect(balance.toNumber('sat')).toBe(0);
    expect(balance.currency).toBe('BTC');
  });
});

describe('AccountsDomainImpl.suggestFor (pure pick → SYNC)', () => {
  test('recommends the funded online account for a token-receive, returning the value DIRECTLY', () => {
    const a = cashuAccount({ id: 'a', sats: 0 });
    const { domain } = buildDomain();
    const intent: PaymentIntent = { kind: 'token-receive', token: 'cashuAx' };

    const result = domain.suggestFor(intent, [a]);
    // SYNC: an AccountSuggestion, not a Query.
    expect(result.recommended.id).toBe('a');
    expect(Array.isArray(result.alternatives)).toBe(true);
  });

  test('is pure over the passed-in accounts (no session read) — falls back to the first insufficient when none has enough balance', () => {
    const a = cashuAccount({ id: 'a', sats: 10 });
    const def = cashuAccount({ id: 'btc-default', sats: 20 });
    const { domain } = buildDomain();
    const intent: PaymentIntent = {
      kind: 'send',
      destination: {
        kind: 'bolt11',
        invoice: {
          amountSat: 5000,
          amountMsat: 5000000,
          createdAtUnixMs: 0,
          expiryUnixMs: 0,
          network: 'bitcoin',
          description: undefined,
          payeeNodeKey: '00'.repeat(33),
          paymentHash: 'hash',
        },
      },
      amount: new Money<Currency>({
        amount: 5000,
        currency: 'BTC',
        unit: 'sat',
      }),
    };

    // SYNC `suggestFor` does NOT read the session for a default-account id, so the fallback
    // degrades to the first insufficient account (the pure suggester's no-default behaviour).
    const result = domain.suggestFor(intent, [a, def]);
    expect(result.recommended.id).toBe('a');
  });

  test('works without a session set up at all (pure over accounts)', () => {
    const a = cashuAccount({ id: 'a', sats: 1000 });
    const { domain } = buildDomain({ user: null });
    const intent: PaymentIntent = { kind: 'receive' };

    const result = domain.suggestFor(intent, [a]);
    expect(result.recommended.id).toBe('a');
  });
});
