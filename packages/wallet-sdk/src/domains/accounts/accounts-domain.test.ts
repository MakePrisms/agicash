import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import type { SdkConfig } from '../../config';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { AccountRepository } from '../../internal/repositories/account-repository';
import {
  inMemoryStorage,
  jwtWith,
  makeFakeDb,
} from '../../internal/test-support';
import type { DomainContext } from '../context';
import { createAccountsDomain } from './accounts-domain';

const userRow = {
  id: 'u1',
  username: 'a',
  email: 'a@b.co',
  email_verified: true,
  created_at: 't',
  updated_at: 't',
  cashu_locking_xpub: 'x',
  encryption_public_key: 'e',
  spark_identity_public_key: 's',
  default_btc_account_id: 'btc-acc',
  default_usd_account_id: null,
  default_currency: 'BTC',
  terms_accepted_at: null,
  gift_card_mint_terms_accepted_at: null,
};

// Cast as `never` is the plan's suggested pattern; `as unknown as Account`
// lets the spread on line below type-check while keeping the fake account shape.
const sparkAccount = {
  id: 'btc-acc',
  type: 'spark',
  currency: 'BTC',
  balance: new Money({ amount: 500, currency: 'BTC', unit: 'sat' }),
} as unknown as import('../../types/account').Account;

function ctx(db: ReturnType<typeof makeFakeDb>): {
  ctx: DomainContext;
  events: { user: unknown[]; account: unknown[] };
} {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const events = { user: [] as unknown[], account: [] as unknown[] };
  emitter.on('user:updated', (e) => events.user.push(e));
  emitter.on('account:updated', (e) => events.account.push(e));
  return {
    ctx: {
      config: {
        storage: inMemoryStorage({ access_token: jwtWith({ sub: 'u1' }) }),
        defaultAccounts: [
          {
            type: 'spark',
            currency: 'BTC',
            name: 'Bitcoin',
            network: 'MAINNET',
            purpose: 'transactional',
            isDefault: true,
          },
        ],
      } as unknown as SdkConfig,
      connections: { supabase: db } as unknown as DomainContext['connections'],
      emitter,
    },
    events,
  };
}

const fakeRepo = (over: Partial<AccountRepository> = {}): AccountRepository =>
  ({
    getAllActive: async () => [sparkAccount],
    get: async (id: string) => (id === 'btc-acc' ? sparkAccount : null),
    create: async () => ({ ...sparkAccount, id: 'new' }),
    ...over,
  }) as unknown as AccountRepository;

describe('accounts domain', () => {
  it('getDefault reads the user row and returns the default account', async () => {
    const { ctx: c } = ctx(
      makeFakeDb({ selectResult: { data: userRow, error: null } }),
    );
    const account = await createAccountsDomain(c, fakeRepo()).getDefault();
    expect(account?.id).toBe('btc-acc');
  });

  it('setDefault updates the user row and emits user:updated', async () => {
    const calls = { update: [] as unknown[] };
    const { ctx: c, events } = ctx(
      makeFakeDb({
        selectResult: { data: userRow, error: null },
        updateResult: { data: userRow, error: null },
        calls,
      }),
    );
    await createAccountsDomain(c, fakeRepo()).setDefault(sparkAccount);
    expect(calls.update[0]).toEqual({
      default_btc_account_id: 'btc-acc',
      default_usd_account_id: null,
    });
    expect(events.user).toHaveLength(1);
  });

  it('add(spark) creates + emits account:updated{op:created}', async () => {
    const { ctx: c, events } = ctx(makeFakeDb({}));
    const created = await createAccountsDomain(c, fakeRepo()).add({
      type: 'spark',
      currency: 'BTC',
    });
    expect(created.id).toBe('new');
    expect(events.account).toHaveLength(1);
    expect(events.account[0]).toEqual({ account: created, op: 'created' });
  });

  it('getBalance returns the spark balance', async () => {
    const { ctx: c } = ctx(makeFakeDb({}));
    const balance = await createAccountsDomain(c, fakeRepo()).getBalance(
      sparkAccount,
    );
    expect(balance.toString()).toBe(
      new Money({ amount: 500, currency: 'BTC', unit: 'sat' }).toString(),
    );
  });

  it('add persists a non-transactional cashu purpose + expiresAt', async () => {
    const createSpy = mock(async (input: unknown) => ({
      ...sparkAccount,
      ...(input as object),
      id: 'new',
    }));
    const { ctx: c } = ctx(makeFakeDb({}));
    const created = await createAccountsDomain(
      c,
      fakeRepo({ create: createSpy as unknown as AccountRepository['create'] }),
    ).add({
      type: 'cashu',
      mintUrl: 'https://mint.example',
      currency: 'BTC',
      purpose: 'gift-card',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'gift-card',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    );
    expect(created.purpose).toBe('gift-card');
  });

  it('add defaults cashu purpose to transactional / expiresAt null', async () => {
    const createSpy = mock(async (input: unknown) => ({
      ...sparkAccount,
      ...(input as object),
      id: 'new',
    }));
    const { ctx: c } = ctx(makeFakeDb({}));
    await createAccountsDomain(
      c,
      fakeRepo({ create: createSpy as unknown as AccountRepository['create'] }),
    ).add({
      type: 'cashu',
      mintUrl: 'https://mint.example',
      currency: 'BTC',
    });
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'transactional', expiresAt: null }),
    );
  });
});
