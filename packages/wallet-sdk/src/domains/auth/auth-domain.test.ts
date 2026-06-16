import { afterAll, describe, expect, it, mock } from 'bun:test';
import {
  breezModuleMock,
  inMemoryStorage,
  jwtWith,
  makeFakeDb,
  openSecretModuleMock,
} from '../../internal/test-support';

const calls = {
  signIn: [] as unknown[],
  signUp: [] as unknown[],
  signUpGuest: [] as unknown[],
  signInGuest: [] as unknown[],
  resetPassword: [] as unknown[],
  verifyEmail: [] as unknown[],
};

mock.module('@agicash/opensecret', () =>
  openSecretModuleMock({
    signIn: async (...a: unknown[]) => {
      calls.signIn.push(a);
      return { id: 'u1', access_token: 'a', refresh_token: 'r' };
    },
    signUp: async (...a: unknown[]) => {
      calls.signUp.push(a);
      return { id: 'u1', access_token: 'a', refresh_token: 'r' };
    },
    signUpGuest: async (...a: unknown[]) => {
      calls.signUpGuest.push(a);
      return { id: 'guest-1', access_token: 'a', refresh_token: 'r' };
    },
    signInGuest: async (...a: unknown[]) => {
      calls.signInGuest.push(a);
      return { id: 'guest-1', access_token: 'a', refresh_token: 'r' };
    },
    requestPasswordReset: async (...a: unknown[]) => {
      calls.resetPassword.push(a);
    },
    verifyEmail: async (...a: unknown[]) => {
      calls.verifyEmail.push(a);
    },
    initiateGoogleAuth: async () => ({
      auth_url: 'https://accounts.google/x',
      csrf_token: 'c',
    }),
    fetchUser: async () => ({ user: { id: 'u1', email_verified: false } }),
  }),
);
mock.module('@agicash/breez-sdk-spark', () => breezModuleMock());
afterAll(() => mock.restore());

const { createAuthDomain } = await import('./auth-domain');
import type { SdkConfig } from '../../config';
import type { SdkEventMap } from '../../events';
import type { KeyProvider } from '../../internal/crypto/keys';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { DomainContext } from '../context';

const guestRow = {
  id: 'u1',
  username: 'alice',
  email: null,
  email_verified: false,
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

const keys: KeyProvider = {
  getChildMnemonic: async () =>
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  getPrivateKeyBytes: async () => new Uint8Array(32),
  getPublicKeyHex: async () => 'enc-pub',
};

function setup(db: ReturnType<typeof makeFakeDb>) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const signedIn: unknown[] = [];
  const signedOut: unknown[] = [];
  const updated: unknown[] = [];
  emitter.on('auth:signed-in', (e) => signedIn.push(e));
  emitter.on('auth:signed-out', (e) => signedOut.push(e));
  emitter.on('user:updated', (e) => updated.push(e));
  const ctx: DomainContext = {
    config: {
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
      storage: inMemoryStorage({
        access_token: jwtWith({ sub: 'u1' }),
        refresh_token: jwtWith({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      }),
    } as unknown as SdkConfig,
    connections: { supabase: db, keys } as unknown as DomainContext['connections'],
    emitter,
  };
  return { ctx, signedIn, signedOut, updated };
}

describe('auth domain', () => {
  it('signIn resolves the existing user + emits auth:signed-in', async () => {
    calls.signIn.length = 0;
    const { ctx, signedIn } = setup(
      makeFakeDb({ selectResult: { data: guestRow, error: null } }),
    );
    const user = await createAuthDomain(ctx).signIn({
      email: 'a@b.co',
      password: 'pw',
    });
    expect(user.id).toBe('u1');
    expect(calls.signIn.at(-1)).toEqual(['a@b.co', 'pw']);
    expect(signedIn).toHaveLength(1);
  });

  it('signUp bootstraps (upsert) + emits auth:signed-in', async () => {
    calls.signUp.length = 0;
    const { ctx, signedIn } = setup(
      makeFakeDb({
        selectResult: { data: null, error: null },
        rpcResult: { data: { user: guestRow, accounts: [] }, error: null },
      }),
    );
    await createAuthDomain(ctx).signUp({ email: 'a@b.co', password: 'pw' });
    expect(calls.signUp.at(-1)).toEqual(['a@b.co', 'pw', '']);
    expect(signedIn).toHaveLength(1);
  });

  it('signInGuest with no stored creds signs up + stores creds', async () => {
    calls.signUpGuest.length = 0;
    const { ctx } = setup(
      makeFakeDb({
        selectResult: { data: null, error: null },
        rpcResult: { data: { user: guestRow, accounts: [] }, error: null },
      }),
    );
    await createAuthDomain(ctx).signInGuest();
    expect(calls.signUpGuest).toHaveLength(1);
    expect(await ctx.config.storage.persistent.getItem('guestAccount')).toContain(
      'guest-1',
    );
  });

  it('signInGuest with stored creds signs in with them', async () => {
    calls.signInGuest.length = 0;
    const { ctx } = setup(
      makeFakeDb({ selectResult: { data: guestRow, error: null } }),
    );
    await ctx.config.storage.persistent.setItem(
      'guestAccount',
      JSON.stringify({ id: 'guest-1', password: 'pw' }),
    );
    await createAuthDomain(ctx).signInGuest();
    expect(calls.signInGuest.at(-1)).toEqual(['guest-1', 'pw']);
  });

  it('signOut emits auth:signed-out', async () => {
    const { ctx, signedOut } = setup(makeFakeDb({}));
    await createAuthDomain(ctx).signOut();
    expect(signedOut).toHaveLength(1);
  });

  it('resetPassword hashes the secret and returns it', async () => {
    calls.resetPassword.length = 0;
    const { ctx } = setup(makeFakeDb({}));
    const { secret } = await createAuthDomain(ctx).resetPassword('a@b.co');
    expect(typeof secret).toBe('string');
    const [email, hash] = calls.resetPassword.at(-1) as [string, string];
    expect(email).toBe('a@b.co');
    expect(hash).not.toBe(secret);
  });

  it('verifyEmail re-resolves + emits user:updated', async () => {
    calls.verifyEmail.length = 0;
    const { ctx, updated } = setup(
      makeFakeDb({ selectResult: { data: guestRow, error: null } }),
    );
    const user = await createAuthDomain(ctx).verifyEmail('123456');
    expect(user.id).toBe('u1');
    expect(calls.verifyEmail.at(-1)).toEqual(['123456']);
    expect(updated).toHaveLength(1);
  });

  it('beginGoogleSignIn returns the auth url', async () => {
    const { ctx } = setup(makeFakeDb({}));
    const { authUrl } = await createAuthDomain(ctx).beginGoogleSignIn();
    expect(authUrl).toBe('https://accounts.google/x');
  });
});
