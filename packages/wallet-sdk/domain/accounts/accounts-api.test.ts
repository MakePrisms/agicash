import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import type { AgicashDb } from '../../db/database';
import { NoSessionError, SessionEndedError } from '../../lib/error';
import type { SparkWalletConfig } from '../../lib/spark/wallet';
import type { AddCashuAccountParams, AuthSession, AuthUser } from '../sdk';
import { createSessionKeys } from '../sdk/session-keys';
import {
  type Account as DomainAccount,
  type CashuAccount as DomainCashuAccount,
  type SparkAccount as DomainSparkAccount,
  getAccountBalance,
} from './account';
import type { AccountRepository } from './account-repository';
import { createAccountsApi } from './accounts-api';

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

const loggedIn = (id: string): AuthSession => ({
  isLoggedIn: true,
  user: authUser(id),
});

const cashuDomain = (
  overrides: Partial<Record<string, unknown>> = {},
): DomainCashuAccount =>
  ({
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
    keysetCounters: {},
    proofs: [{ amount: 100 }, { amount: 50 }],
    wallet: { marker: 'cashu-wallet' },
    ...overrides,
  }) as unknown as DomainCashuAccount;

const sparkDomain = (): DomainSparkAccount =>
  ({
    id: 'acct-spark',
    name: 'Bitcoin',
    type: 'spark',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    currency: 'BTC',
    createdAt: '2026-01-01T00:00:00Z',
    version: 1,
    expiresAt: null,
    network: 'MAINNET',
    balance: new Money({ amount: 42, currency: 'BTC', unit: 'sat' }),
    wallet: { marker: 'spark-wallet' },
  }) as unknown as DomainSparkAccount;

const makeApi = (deps: {
  session: AuthSession;
  repository?: Partial<AccountRepository>;
}) =>
  createAccountsApi({
    db: {} as unknown as AgicashDb,
    keys: createSessionKeys(),
    sparkConfig: { storageDir: '.', apiKey: 'k' } satisfies SparkWalletConfig,
    getSession: () => deps.session,
    createRepository: async () =>
      (deps.repository ?? {}) as unknown as AccountRepository,
  });

describe('createAccountsApi', () => {
  describe('cashu.add', () => {
    it('re-injects type:cashu and the session userId, then returns the created account', async () => {
      let created: Record<string, unknown> | undefined;
      const { api } = makeApi({
        session: loggedIn('user-x'),
        repository: {
          create: (async (input: Record<string, unknown>) => {
            created = input;
            return cashuDomain({ mintUrl: input.mintUrl as string });
          }) as unknown as AccountRepository['create'],
        },
      });

      const params: AddCashuAccountParams = {
        name: 'My mint',
        mintUrl: 'https://testnut.cashu.space',
        currency: 'BTC',
        purpose: 'transactional',
      };
      const result = await api.cashu.add(params);

      expect(created?.type).toBe('cashu');
      expect(created?.userId).toBe('user-x');
      expect(created?.name).toBe('My mint');
      expect(created?.currency).toBe('BTC');
      expect(created?.purpose).toBe('transactional');
      // the return is the domain account: proofs ride along, balance derives
      expect(result.proofs).toBeDefined();
      expect(getAccountBalance(result)?.amount('sat').toNumber()).toBe(150);
    });

    it('throws NoSessionError without a session', async () => {
      const { api } = makeApi({ session: { isLoggedIn: false } });
      await expect(
        api.cashu.add({
          name: 'x',
          mintUrl: 'https://testnut.cashu.space',
          currency: 'BTC',
          purpose: 'transactional',
        }),
      ).rejects.toBeInstanceOf(NoSessionError);
    });

    it('rejects with SessionEndedError and creates nothing when the session ends before the write', async () => {
      const keys = createSessionKeys();
      let createCalls = 0;
      const { api } = createAccountsApi({
        db: {} as unknown as AgicashDb,
        keys,
        sparkConfig: {
          storageDir: '.',
          apiKey: 'k',
        } satisfies SparkWalletConfig,
        getSession: () => loggedIn('user-x'),
        createRepository: async () => {
          keys.reset();
          return {
            create: (async () => {
              createCalls += 1;
              return cashuDomain();
            }) as unknown as AccountRepository['create'],
          } as unknown as AccountRepository;
        },
      });

      await expect(
        api.cashu.add({
          name: 'My mint',
          mintUrl: 'https://testnut.cashu.space',
          currency: 'BTC',
          purpose: 'transactional',
        }),
      ).rejects.toBeInstanceOf(SessionEndedError);
      expect(createCalls).toBe(0);
    });
  });

  describe('list', () => {
    it('returns every active account for the session user', async () => {
      let requestedUserId: string | undefined;
      const { api } = makeApi({
        session: loggedIn('user-x'),
        repository: {
          getAllActive: (async (userId: string) => {
            requestedUserId = userId;
            return [cashuDomain(), sparkDomain()] as DomainAccount[];
          }) as unknown as AccountRepository['getAllActive'],
        },
      });

      const accounts = await api.list();

      expect(requestedUserId).toBe('user-x');
      expect(accounts).toHaveLength(2);
      const balances = accounts.map((account) =>
        getAccountBalance(account)?.amount('sat').toNumber(),
      );
      expect(balances).toEqual([150, 42]);
    });

    it('throws NoSessionError without a session', async () => {
      const { api } = makeApi({ session: { isLoggedIn: false } });
      await expect(api.list()).rejects.toBeInstanceOf(NoSessionError);
    });

    it('rejects with SessionEndedError and issues no read when the session ends before the read', async () => {
      const keys = createSessionKeys();
      let getAllActiveCalls = 0;
      const { api } = createAccountsApi({
        db: {} as unknown as AgicashDb,
        keys,
        sparkConfig: {
          storageDir: '.',
          apiKey: 'k',
        } satisfies SparkWalletConfig,
        getSession: () => loggedIn('user-x'),
        createRepository: async () => {
          // The session ends between the signal capture and the read.
          keys.reset();
          return {
            getAllActive: (async () => {
              getAllActiveCalls += 1;
              return [];
            }) as unknown as AccountRepository['getAllActive'],
          } as unknown as AccountRepository;
        },
      });

      await expect(api.list()).rejects.toBeInstanceOf(SessionEndedError);
      expect(getAllActiveCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends while the read hydrates', async () => {
      const keys = createSessionKeys();
      const { api } = createAccountsApi({
        db: {} as unknown as AgicashDb,
        keys,
        sparkConfig: {
          storageDir: '.',
          apiKey: 'k',
        } satisfies SparkWalletConfig,
        getSession: () => loggedIn('user-x'),
        createRepository: async () =>
          ({
            getAllActive: (async () => {
              // The session ends while the repository hydrates the rows.
              keys.reset();
              return [] as DomainAccount[];
            }) as unknown as AccountRepository['getAllActive'],
          }) as unknown as AccountRepository,
      });

      await expect(api.list()).rejects.toBeInstanceOf(SessionEndedError);
    });
  });

  describe('get', () => {
    it('returns a found account', async () => {
      const { api } = makeApi({
        session: loggedIn('user-x'),
        repository: {
          get: (async () =>
            cashuDomain()) as unknown as AccountRepository['get'],
        },
      });

      const account = await api.get('acct-cashu');

      if (!account) throw new Error('expected an account');
      expect(getAccountBalance(account)?.amount('sat').toNumber()).toBe(150);
    });

    it('returns null when the account is not found', async () => {
      const { api } = makeApi({
        session: loggedIn('user-x'),
        repository: {
          get: (async () => null) as unknown as AccountRepository['get'],
        },
      });

      expect(await api.get('missing')).toBeNull();
    });
  });

  describe('AddCashuAccountParams (B3)', () => {
    it('accepts exactly name, mintUrl, currency, purpose', () => {
      const params: AddCashuAccountParams = {
        name: 'My mint',
        mintUrl: 'https://testnut.cashu.space',
        currency: 'BTC',
        purpose: 'transactional',
      };
      expect(params).toBeDefined();

      const withUserId: AddCashuAccountParams = {
        name: 'My mint',
        mintUrl: 'https://testnut.cashu.space',
        currency: 'BTC',
        purpose: 'transactional',
        // @ts-expect-error - userId is session-implicit, not part of the params
        userId: 'user-x',
      };
      expect(withUserId).toBeDefined();
    });
  });
});
