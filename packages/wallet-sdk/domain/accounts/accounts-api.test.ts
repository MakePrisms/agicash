import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import type { AgicashDb } from '../../db/database';
import { NoSessionError } from '../../lib/error';
import type { SparkWalletConfig } from '../../lib/spark/wallet';
import type { AddCashuAccountParams, AuthSession, AuthUser } from '../../sdk';
import { createSessionKeys } from '../../session-keys';
import type {
  Account as DomainAccount,
  CashuAccount as DomainCashuAccount,
  SparkAccount as DomainSparkAccount,
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
    it('re-injects type:cashu and the session userId, then maps the result', async () => {
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
      // the return is mapped: balance attached, hidden fields ride along
      expect(result.balance).toBeInstanceOf(Money);
      expect((result as unknown as DomainCashuAccount).proofs).toBeDefined();
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
  });

  describe('list', () => {
    it('maps every active account for the session user through the projection mapper', async () => {
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
      expect(accounts[0]?.balance?.amount('sat').toNumber()).toBe(150);
      expect(accounts[1]?.balance?.amount('sat').toNumber()).toBe(42);
    });

    it('throws NoSessionError without a session', async () => {
      const { api } = makeApi({ session: { isLoggedIn: false } });
      await expect(api.list()).rejects.toBeInstanceOf(NoSessionError);
    });
  });

  describe('get', () => {
    it('maps a found account through the projection mapper', async () => {
      const { api } = makeApi({
        session: loggedIn('user-x'),
        repository: {
          get: (async () =>
            cashuDomain()) as unknown as AccountRepository['get'],
        },
      });

      const account = await api.get('acct-cashu');

      expect(account?.balance?.amount('sat').toNumber()).toBe(150);
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
