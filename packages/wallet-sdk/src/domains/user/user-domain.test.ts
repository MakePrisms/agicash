import { afterAll, describe, expect, it, mock } from 'bun:test';
import {
  breezModuleMock,
  inMemoryStorage,
  jwtWith,
  makeFakeDb,
  openSecretModuleMock,
} from '../../internal/test-support';

mock.module('@agicash/opensecret', () =>
  openSecretModuleMock({
    fetchUser: async () => ({
      user: { id: 'u1', email: 'a@b.co', email_verified: true },
    }),
  }),
);
mock.module('@agicash/breez-sdk-spark', () => breezModuleMock());
afterAll(() => mock.restore());

const { createUserDomain } = await import('./user-domain');
import type { SdkConfig } from '../../config';
import { DomainError, SdkError } from '../../errors';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { DomainContext } from '../context';

const dbRow = {
  id: 'u1',
  username: 'alice',
  email: 'a@b.co',
  email_verified: true,
  created_at: 't',
  updated_at: 't',
  cashu_locking_xpub: 'x',
  encryption_public_key: 'e',
  spark_identity_public_key: 's',
  default_btc_account_id: 'btc',
  default_usd_account_id: null,
  default_currency: 'BTC',
  terms_accepted_at: null,
  gift_card_mint_terms_accepted_at: null,
};

function setup(db: ReturnType<typeof makeFakeDb>) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const updated: Array<{ user: { id: string } }> = [];
  emitter.on('user:updated', (e) => updated.push(e));
  const ctx: DomainContext = {
    config: {
      storage: inMemoryStorage({
        access_token: jwtWith({ sub: 'u1' }),
        refresh_token: jwtWith({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      }),
    } as unknown as SdkConfig,
    connections: { supabase: db } as unknown as DomainContext['connections'],
    emitter,
  };
  return { ctx, updated };
}

describe('user domain', () => {
  it('updateUsername updates + emits user:updated', async () => {
    const calls = { update: [] as unknown[] };
    const { ctx, updated } = setup(
      makeFakeDb({ updateResult: { data: dbRow, error: null }, calls }),
    );
    const user = await createUserDomain(ctx).updateUsername('alice');
    expect(user.username).toBe('alice');
    expect(calls.update[0]).toEqual({ username: 'alice' });
    expect(updated).toHaveLength(1);
  });

  it('updateUsername surfaces a taken username as DomainError (no event)', async () => {
    const { ctx, updated } = setup(
      makeFakeDb({
        updateResult: { data: null, error: { code: '23505', message: 'dup' } },
      }),
    );
    await expect(
      createUserDomain(ctx).updateUsername('taken'),
    ).rejects.toBeInstanceOf(DomainError);
    expect(updated).toHaveLength(0);
  });

  it('acceptTerms({wallet:true}) sets only terms_accepted_at', async () => {
    const calls = { update: [] as unknown[] };
    const { ctx } = setup(
      makeFakeDb({ updateResult: { data: dbRow, error: null }, calls }),
    );
    await createUserDomain(ctx).acceptTerms({ wallet: true });
    const payload = calls.update[0] as Record<string, unknown>;
    expect(typeof payload.terms_accepted_at).toBe('string');
    expect('gift_card_mint_terms_accepted_at' in payload).toBe(false);
  });

  it('setDefaultCurrency updates default_currency', async () => {
    const calls = { update: [] as unknown[] };
    const { ctx } = setup(
      makeFakeDb({ updateResult: { data: dbRow, error: null }, calls }),
    );
    await createUserDomain(ctx).setDefaultCurrency('USD');
    expect(calls.update[0]).toEqual({ default_currency: 'USD' });
  });

  it('getCurrentUser resolves the existing row (no drift)', async () => {
    const { ctx } = setup(
      makeFakeDb({ selectResult: { data: dbRow, error: null } }),
    );
    const user = await createUserDomain(ctx).getCurrentUser();
    expect(user?.id).toBe('u1');
  });

  it('mutations throw SdkError(NOT_AUTHENTICATED) when there is no session', async () => {
    const emitter = new SdkEventEmitter<SdkEventMap>();
    const ctx: DomainContext = {
      config: { storage: inMemoryStorage() } as unknown as SdkConfig,
      connections: {
        supabase: makeFakeDb({}),
      } as unknown as DomainContext['connections'],
      emitter,
    };
    const err = await createUserDomain(ctx)
      .updateUsername('x')
      .catch((e) => e);
    expect(err).toBeInstanceOf(SdkError);
    expect((err as SdkError).code).toBe('NOT_AUTHENTICATED');
  });

  it('acceptTerms({giftCardMint:true}) sets only gift_card_mint_terms_accepted_at', async () => {
    const calls = { update: [] as unknown[] };
    const { ctx } = setup(
      makeFakeDb({ updateResult: { data: dbRow, error: null }, calls }),
    );
    await createUserDomain(ctx).acceptTerms({ giftCardMint: true });
    const payload = calls.update[0] as Record<string, unknown>;
    expect(typeof payload.gift_card_mint_terms_accepted_at).toBe('string');
    expect('terms_accepted_at' in payload).toBe(false);
  });
});
