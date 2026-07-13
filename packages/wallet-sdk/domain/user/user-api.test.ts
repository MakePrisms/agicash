import { describe, expect, it } from 'bun:test';
import { core, z } from 'zod/mini';
import type { AgicashDb } from '../../db/database';
import type { Encryption } from '../../lib/encryption';
import type { SparkWalletConfig } from '../../lib/spark/wallet';
import type { AuthUser } from '../../sdk';
import type { SessionKeys } from '../../session-keys';
import { createUserApi } from './user-api';

const authUser = (id: string, overrides: Partial<AuthUser> = {}): AuthUser =>
  ({
    id,
    name: null,
    email: 'a@b.c',
    email_verified: true,
    login_method: 'email',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  }) as AuthUser;

const dbUserRow = (id: string) => ({
  id,
  username: 'name',
  email: 'a@b.c',
  email_verified: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  cashu_locking_xpub: 'xpub',
  encryption_public_key: 'enc',
  spark_identity_public_key: 'spark',
  default_btc_account_id: 'acct-1',
  default_usd_account_id: null,
  default_currency: 'BTC',
  terms_accepted_at: null,
  gift_card_mint_terms_accepted_at: null,
});

const sparkConfig: SparkWalletConfig = { storageDir: '.', apiKey: 'k' };

const fakeKeys = (): SessionKeys => ({
  getEncryption: async () => ({}) as Encryption,
  getEncryptionPublicKey: async () => 'enc-pub',
  getCashuSeed: async () => new Uint8Array(64),
  getSparkMnemonic: async () => 'mnemonic',
  getCashuLockingXpub: async () => 'xpub',
  getSparkIdentityPublicKey: async () => 'spark-id',
  reset: () => undefined,
});

type Filters = Record<string, unknown>;

/**
 * Chainable fake covering exactly the two query shapes setDefaultAccount
 * issues: the accounts ownership read and the users row update.
 */
const createDbFake = (deps: {
  onAccountRead: (filters: Filters) => Record<string, unknown>;
  onUserUpdate: (filters: Filters, data: Record<string, unknown>) => void;
}) => {
  const from = (table: string) => {
    const filters: Filters = {};
    let updateData: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      update: (data: Record<string, unknown>) => {
        updateData = data;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      single: async () => {
        if (table === 'accounts') {
          return { data: deps.onAccountRead(filters), error: null };
        }
        deps.onUserUpdate(filters, updateData);
        return { data: dbUserRow(String(filters.id)), error: null };
      },
    };
    return chain;
  };
  return { from } as unknown as AgicashDb;
};

/** Fake covering the single `upsert_user_with_accounts` RPC ensure issues. */
const createUpsertDbFake = (
  outcomes: Array<{ reject: unknown } | { ok: true }>,
) => {
  const calls: Record<string, unknown>[] = [];
  const db = {
    rpc: (_name: string, params: Record<string, unknown>) => {
      const outcome = outcomes[Math.min(calls.length, outcomes.length - 1)];
      calls.push(params);
      if ('reject' in outcome) {
        return Promise.reject(outcome.reject);
      }
      return Promise.resolve({
        data: {
          user: dbUserRow(String(params.p_user_id)),
          accounts: [],
        },
        error: null,
      });
    },
  } as unknown as AgicashDb;
  return { db, calls };
};

const makeZodError = (): unknown => {
  try {
    z.number().parse('not a number');
  } catch (error) {
    return error;
  }
  throw new Error('expected zod parse to throw');
};

describe('createUserApi', () => {
  describe('setDefaultAccount', () => {
    it('writes onto the user that validated account ownership, not the current session user', async () => {
      let sessionUserId = 'user-a';
      let updatedUserId: unknown;
      let updatedData: Record<string, unknown> = {};
      const { api } = createUserApi({
        db: createDbFake({
          onAccountRead: (filters) => {
            // the session switches while the account read is in flight
            sessionUserId = 'user-b';
            return { id: filters.id, currency: 'BTC' };
          },
          onUserUpdate: (filters, data) => {
            updatedUserId = filters.id;
            updatedData = data;
          },
        }),
        getSession: () => ({ isLoggedIn: true, user: authUser(sessionUserId) }),
        keys: fakeKeys(),
        sparkConfig,
      });

      await api.setDefaultAccount({ accountId: 'acct-1' });

      expect(updatedUserId).toBe('user-a');
      expect(updatedData.default_btc_account_id).toBe('acct-1');
    });
  });

  describe('ensure', () => {
    it('upserts with the derived keys and terms, returning the user and accounts', async () => {
      const { db, calls } = createUpsertDbFake([{ ok: true }]);
      const { api } = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys: fakeKeys(),
        sparkConfig,
      });

      const result = await api.ensure({
        termsAcceptedAt: '2026-01-02T00:00:00Z',
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.p_user_id).toBe('user-a');
      expect(calls[0]?.p_cashu_locking_xpub).toBe('xpub');
      expect(calls[0]?.p_encryption_public_key).toBe('enc-pub');
      expect(calls[0]?.p_spark_identity_public_key).toBe('spark-id');
      expect(calls[0]?.p_terms_accepted_at).toBe('2026-01-02T00:00:00Z');
      expect(result.user.id).toBe('user-a');
      expect(result.accounts).toEqual([]);
    });

    it('memoizes per unchanged session, skipping the second upsert', async () => {
      const { db, calls } = createUpsertDbFake([{ ok: true }]);
      const { api } = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys: fakeKeys(),
        sparkConfig,
      });

      const first = await api.ensure({});
      const second = await api.ensure({});

      expect(calls).toHaveLength(1);
      expect(second).toBe(first);
    });

    it('re-upserts when the session user has changed', async () => {
      const { db, calls } = createUpsertDbFake([{ ok: true }]);
      let verified = true;
      const { api } = createUserApi({
        db,
        getSession: () => ({
          isLoggedIn: true,
          user: authUser('user-a', { email_verified: verified }),
        }),
        keys: fakeKeys(),
        sparkConfig,
      });

      await api.ensure({});
      verified = false;
      await api.ensure({});

      expect(calls).toHaveLength(2);
    });

    it('re-upserts after reset (session end)', async () => {
      const { db, calls } = createUpsertDbFake([{ ok: true }]);
      const { api, reset } = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys: fakeKeys(),
        sparkConfig,
      });

      await api.ensure({});
      reset();
      await api.ensure({});

      expect(calls).toHaveLength(2);
    });

    it('retries a generic upsert failure, then succeeds', async () => {
      const { db, calls } = createUpsertDbFake([
        { reject: new Error('transient') },
        { ok: true },
      ]);
      const { api } = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys: fakeKeys(),
        sparkConfig,
      });

      const result = await api.ensure({});

      expect(calls).toHaveLength(2);
      expect(result.user.id).toBe('user-a');
    });

    it('does not retry a Zod validation error', async () => {
      const zodError = makeZodError();
      expect(zodError).toBeInstanceOf(core.$ZodError);
      const { db, calls } = createUpsertDbFake([{ reject: zodError }]);
      const { api } = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys: fakeKeys(),
        sparkConfig,
      });

      await expect(api.ensure({})).rejects.toBe(zodError);
      expect(calls).toHaveLength(1);
    });

    it('throws NoSessionError without a session', async () => {
      const { db } = createUpsertDbFake([{ ok: true }]);
      const { api } = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: false }),
        keys: fakeKeys(),
        sparkConfig,
      });

      await expect(api.ensure({})).rejects.toThrow();
    });
  });
});
