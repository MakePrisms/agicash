import { describe, expect, mock, test } from 'bun:test';
import { UserDomain } from './user';

const USER = { id: 'u1', isGuest: false, email: 'a@b.c', username: 'alice' };

const makeDomain = (over: {
  get?: ReturnType<typeof mock>;
  update?: ReturnType<typeof mock>;
  userId?: string | null;
}) =>
  new UserDomain({
    readUserRepo: { get: over.get ?? mock(async () => USER) },
    writeUserRepo: { update: over.update ?? mock(async () => USER) },
    getCurrentUserId: async () => over.userId ?? null,
  } as unknown as ConstructorParameters<typeof UserDomain>[0]);

describe('UserDomain', () => {
  test('get returns null when signed out', async () => {
    expect(await makeDomain({ userId: null }).get()).toBeNull();
  });

  test('get reads the current user when signed in', async () => {
    const get = mock(async () => USER);
    const domain = makeDomain({ get, userId: 'u1' });
    expect((await domain.get())?.id).toBe('u1');
    expect(get).toHaveBeenCalledWith('u1');
  });

  test('updateUsername delegates to repo.update', async () => {
    const update = mock(async () => ({ ...USER, username: 'bob' }));
    const domain = makeDomain({ update, userId: 'u1' });
    const result = await domain.updateUsername('bob');
    expect(result.username).toBe('bob');
    expect(update).toHaveBeenCalledWith('u1', { username: 'bob' });
  });

  test('acceptTerms sets only the requested terms columns', async () => {
    const update = mock(async () => USER);
    const domain = makeDomain({ update, userId: 'u1' });

    await domain.acceptTerms({ walletTerms: true });
    const wallet = update.mock.calls[0] as unknown as [
      string,
      { termsAcceptedAt?: string; giftCardMintTermsAcceptedAt?: string },
    ];
    expect(wallet[0]).toBe('u1');
    expect(typeof wallet[1].termsAcceptedAt).toBe('string');
    expect(wallet[1].giftCardMintTermsAcceptedAt).toBeUndefined();

    await domain.acceptTerms({ giftCardTerms: true });
    const gift = update.mock.calls[1] as unknown as [
      string,
      { termsAcceptedAt?: string; giftCardMintTermsAcceptedAt?: string },
    ];
    expect(gift[1].termsAcceptedAt).toBeUndefined();
    expect(typeof gift[1].giftCardMintTermsAcceptedAt).toBe('string');
  });

  test('acceptTerms requires a user', async () => {
    await expect(
      makeDomain({ userId: null }).acceptTerms({ walletTerms: true }),
    ).rejects.toThrow();
  });

  test('setDefaultAccount writes the currency-matched id, currency only when asked', async () => {
    const update = mock(async () => USER);
    const domain = makeDomain({ update, userId: 'u1' });

    await domain.setDefaultAccount({
      account: { id: 'acc-btc', currency: 'BTC' } as never,
    });
    expect(update.mock.calls[0]).toEqual([
      'u1',
      { defaultBtcAccountId: 'acc-btc' },
    ] as never);

    await domain.setDefaultAccount({
      account: { id: 'acc-usd', currency: 'USD' } as never,
      setDefaultCurrency: true,
    });
    expect(update.mock.calls[1]).toEqual([
      'u1',
      { defaultUsdAccountId: 'acc-usd', defaultCurrency: 'USD' },
    ] as never);
  });

  test('setDefaultAccount rejects unsupported currencies', async () => {
    const domain = makeDomain({ userId: 'u1' });
    await expect(
      domain.setDefaultAccount({
        account: { id: 'x', currency: 'EUR' } as never,
      }),
    ).rejects.toThrow('Unsupported currency');
  });
});
