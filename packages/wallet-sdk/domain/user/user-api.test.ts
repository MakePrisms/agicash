import { describe, expect, it } from 'bun:test';
import type { Currency } from '@agicash/money';
import { core, z } from 'zod/mini';
import type { AgicashDb } from '../../db/database';
import type { Encryption } from '../../lib/encryption';
import {
  type Account,
  type CashuAccount as DomainCashuAccount,
  getAccountBalance,
} from '../accounts/account';
import type { AccountRepository } from '../accounts/account-repository';
import type { AuthUser } from '../sdk';
import type { SessionKeys } from '../sdk/session-keys';
import { createUserApi } from './user-api';

const authUser = (id: string): AuthUser =>
  ({
    id,
    name: null,
    email: 'a@b.c',
    email_verified: true,
    login_method: 'email',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
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

const account = (id: string, currency: Currency): Account =>
  ({ id, currency }) as unknown as Account;

const fakeAccountRepository = {} as AccountRepository;
const getAccountRepository = async () => fakeAccountRepository;

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
 * Fake covering the one query setDefaultAccount issues: the users row update. A
 * read from any other table would mean the api regressed to fetching the account
 * instead of trusting the cached one the caller passes.
 */
const createDbFake = (
  onUserUpdate: (filters: Filters, data: Record<string, unknown>) => void,
) => {
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
        if (table !== 'users') {
          throw new Error(`unexpected read from "${table}"`);
        }
        onUserUpdate(filters, updateData);
        return { data: dbUserRow(String(filters.id)), error: null };
      },
    };
    return chain;
  };
  return { from } as unknown as AgicashDb;
};

/** Fake covering the single `upsert_user_with_accounts` RPC provision issues. */
const createUpsertDbFake = (
  outcomes: Array<{ reject: unknown } | { ok: true }>,
  accountRows: Record<string, unknown>[] = [],
) => {
  const calls: Record<string, unknown>[] = [];
  const db = {
    rpc: (_name: string, params: Record<string, unknown>) => {
      const outcome = outcomes[Math.min(calls.length, outcomes.length - 1)];
      calls.push(params);
      if (outcome && 'reject' in outcome) {
        return Promise.reject(outcome.reject);
      }
      return Promise.resolve({
        data: {
          user: dbUserRow(String(params.p_user_id)),
          accounts: accountRows,
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
    it('writes the cached account onto the session user, keyed by its currency', async () => {
      let updatedUserId: unknown;
      let updatedData: Record<string, unknown> = {};
      const api = createUserApi({
        db: createDbFake((filters, data) => {
          updatedUserId = filters.id;
          updatedData = data;
        }),
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys: fakeKeys(),
        getAccountRepository,
      });

      await api.setDefaultAccount({ account: account('acct-1', 'BTC') });

      expect(updatedUserId).toBe('user-a');
      expect(updatedData.default_btc_account_id).toBe('acct-1');
    });
  });

  describe('provision', () => {
    it('upserts with the derived keys and terms, returning the user and accounts', async () => {
      const { db, calls } = createUpsertDbFake([{ ok: true }]);
      const api = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys: fakeKeys(),
        getAccountRepository,
      });

      const result = await api.provision({
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

    it('returns the upserted account rows as domain accounts through the repository', async () => {
      const row = { id: 'acct-cashu' };
      const { db, calls } = createUpsertDbFake([{ ok: true }], [row]);
      const domainCashuAccount = {
        id: 'acct-cashu',
        name: 'Testnut BTC',
        type: 'cashu',
        purpose: 'transactional',
        state: 'active',
        isOnline: true,
        currency: 'BTC',
        createdAt: '2026-01-01T00:00:00Z',
        version: 1,
        expiresAt: null,
        mintUrl: 'https://testnut.cashu.space',
        isTestMint: true,
        keysetCounters: { ks1: 3 },
        proofs: [{ amount: 100 }, { amount: 50 }],
        wallet: { marker: 'cashu-wallet' },
      } as unknown as DomainCashuAccount;
      const toAccountCalls: unknown[] = [];
      const api = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys: fakeKeys(),
        getAccountRepository: async () =>
          ({
            toAccount: async (input: unknown) => {
              toAccountCalls.push(input);
              return domainCashuAccount;
            },
          }) as unknown as AccountRepository,
      });

      const result = await api.provision({});

      expect(calls).toHaveLength(1);
      expect(toAccountCalls).toEqual([row]);
      const [account] = result.accounts;
      if (!account) throw new Error('expected an account');
      expect(account.type).toBe('cashu');
      expect(getAccountBalance(account)?.amount('sat').toNumber()).toBe(150);
      expect('proofs' in account).toBe(true);
      expect('wallet' in account).toBe(true);
      expect('keysetCounters' in account).toBe(true);
    });

    it('upserts on every call and returns each call fresh result (no memo)', async () => {
      const rows = [
        dbUserRow('user-a'),
        { ...dbUserRow('user-a'), username: 'renamed' },
      ];
      const calls: Record<string, unknown>[] = [];
      const db = {
        rpc: (_name: string, params: Record<string, unknown>) => {
          const row = rows[Math.min(calls.length, rows.length - 1)];
          calls.push(params);
          return Promise.resolve({
            data: { user: row, accounts: [] },
            error: null,
          });
        },
      } as unknown as AgicashDb;
      const api = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys: fakeKeys(),
        getAccountRepository,
      });

      const first = await api.provision({});
      const second = await api.provision({});

      expect(calls).toHaveLength(2);
      expect(first.user.username).toBe('name');
      expect(second.user.username).toBe('renamed');
    });

    it('carries the terms params into the upsert on every call', async () => {
      const { db, calls } = createUpsertDbFake([{ ok: true }]);
      const api = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys: fakeKeys(),
        getAccountRepository,
      });

      await api.provision({ termsAcceptedAt: 't1' });
      await api.provision({
        termsAcceptedAt: 't2',
        giftCardMintTermsAcceptedAt: 'g2',
      });

      expect(calls).toHaveLength(2);
      expect(calls[0]?.p_terms_accepted_at).toBe('t1');
      expect(calls[0]?.p_gift_card_mint_terms_accepted_at).toBeUndefined();
      expect(calls[1]?.p_terms_accepted_at).toBe('t2');
      expect(calls[1]?.p_gift_card_mint_terms_accepted_at).toBe('g2');
    });

    it('retries a transient key-derivation failure before upserting', async () => {
      const { db, calls } = createUpsertDbFake([{ ok: true }]);
      let attempts = 0;
      const keys = fakeKeys();
      keys.getSparkIdentityPublicKey = async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('transient enclave failure');
        }
        return 'spark-id';
      };
      const api = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys,
        getAccountRepository,
      });

      const result = await api.provision({});

      expect(attempts).toBe(2);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.p_spark_identity_public_key).toBe('spark-id');
      expect(result.user.id).toBe('user-a');
    });

    it('retries a generic upsert failure, then succeeds', async () => {
      const { db, calls } = createUpsertDbFake([
        { reject: new Error('transient') },
        { ok: true },
      ]);
      const api = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys: fakeKeys(),
        getAccountRepository,
      });

      const result = await api.provision({});

      expect(calls).toHaveLength(2);
      expect(result.user.id).toBe('user-a');
    });

    it('does not retry a Zod validation error', async () => {
      const zodError = makeZodError();
      expect(zodError).toBeInstanceOf(core.$ZodError);
      const { db, calls } = createUpsertDbFake([{ reject: zodError }]);
      const api = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: true, user: authUser('user-a') }),
        keys: fakeKeys(),
        getAccountRepository,
      });

      await expect(api.provision({})).rejects.toBe(zodError);
      expect(calls).toHaveLength(1);
    });

    it('throws NoSessionError without a session', async () => {
      const { db } = createUpsertDbFake([{ ok: true }]);
      const api = createUserApi({
        db,
        getSession: () => ({ isLoggedIn: false }),
        keys: fakeKeys(),
        getAccountRepository,
      });

      await expect(api.provision({})).rejects.toThrow();
    });
  });
});
