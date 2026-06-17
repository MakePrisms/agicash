import { describe, expect, mock, test } from 'bun:test';
import { AccountsDomain } from './accounts';

const makeDomain = (over: {
  user?: unknown;
  accountGet?: ReturnType<typeof mock>;
  addCashuAccount?: ReturnType<typeof mock>;
  userId?: string | null;
}) =>
  new AccountsDomain({
    accountRepository: { get: over.accountGet ?? mock(async () => null) },
    accountService: {
      addCashuAccount: over.addCashuAccount ?? mock(async () => ({})),
    },
    readUserRepo: { get: mock(async () => over.user ?? {}) },
    getCurrentUserId: async () => over.userId ?? null,
  } as unknown as ConstructorParameters<typeof AccountsDomain>[0]);

const USER = {
  defaultCurrency: 'USD',
  defaultBtcAccountId: 'acc-btc',
  defaultUsdAccountId: 'acc-usd',
};

describe('AccountsDomain', () => {
  test('get delegates to the repository', async () => {
    const acc = { id: 'a1' };
    const get = mock(async () => acc);
    const result = await makeDomain({ accountGet: get }).get('a1');
    expect(result).toBe(acc as never);
    expect(get).toHaveBeenCalledWith('a1');
  });

  test('getDefault returns the currency-matched default account', async () => {
    const btc = { id: 'acc-btc', currency: 'BTC' };
    const get = mock(async (id: string) => (id === 'acc-btc' ? btc : null));
    const result = await makeDomain({
      user: USER,
      accountGet: get,
      userId: 'u1',
    }).getDefault('BTC');
    expect(result.id).toBe('acc-btc');
    expect(get).toHaveBeenCalledWith('acc-btc');
  });

  test('getDefault falls back to the user default currency', async () => {
    const usd = { id: 'acc-usd', currency: 'USD' };
    const get = mock(async (id: string) => (id === 'acc-usd' ? usd : null));
    const result = await makeDomain({
      user: USER,
      accountGet: get,
      userId: 'u1',
    }).getDefault();
    expect(result.id).toBe('acc-usd');
  });

  test('getDefault throws when no default account is set', async () => {
    const domain = makeDomain({
      user: {
        defaultCurrency: 'BTC',
        defaultBtcAccountId: '',
        defaultUsdAccountId: null,
      },
      userId: 'u1',
    });
    await expect(domain.getDefault('BTC')).rejects.toThrow(
      'No default account found',
    );
  });

  test('getDefault requires a user', async () => {
    await expect(
      makeDomain({ userId: null }).getDefault('BTC'),
    ).rejects.toThrow('No authenticated user');
  });

  test('suggestFor returns the requested account when it resolves', async () => {
    const acc = { id: 'acc-x', currency: 'BTC' };
    const get = mock(async (id: string) => (id === 'acc-x' ? acc : null));
    const result = await makeDomain({
      accountGet: get,
      userId: 'u1',
    }).suggestFor({ accountId: 'acc-x', currency: 'BTC' });
    expect(result.id).toBe('acc-x');
  });

  test('suggestFor falls back to the default when the account is missing', async () => {
    const btc = { id: 'acc-btc', currency: 'BTC' };
    const get = mock(async (id: string) => (id === 'acc-btc' ? btc : null));
    const result = await makeDomain({
      user: {
        defaultCurrency: 'BTC',
        defaultBtcAccountId: 'acc-btc',
        defaultUsdAccountId: null,
      },
      accountGet: get,
      userId: 'u1',
    }).suggestFor({ accountId: 'missing', currency: 'BTC' });
    expect(result.id).toBe('acc-btc');
  });

  test('add delegates to accountService with the current userId', async () => {
    const addCashuAccount = mock(async () => ({ id: 'new' }));
    const input = {
      name: 'Mint',
      type: 'cashu',
      currency: 'BTC',
      mintUrl: 'https://mint.example',
      purpose: 'transactional',
    };
    await makeDomain({ addCashuAccount, userId: 'u1' }).add(input as never);
    expect(addCashuAccount).toHaveBeenCalledWith({
      userId: 'u1',
      account: input,
    });
  });

  test('add requires a user', async () => {
    await expect(makeDomain({ userId: null }).add({} as never)).rejects.toThrow(
      'No authenticated user',
    );
  });
});
