import { describe, expect, it } from 'bun:test';
import type { Currency } from '@agicash/money';
import type { AgicashDb } from '../../db/database';
import type { Account } from '../accounts/account';
import type { AuthUser } from '../sdk';
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

type Filters = Record<string, unknown>;

/**
 * Fake covering the one query setDefaultAccount now issues: the users row
 * update. A read from any other table would mean the api regressed to fetching
 * the account instead of trusting the cached one the caller passes.
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
      });

      await api.setDefaultAccount({ account: account('acct-1', 'BTC') });

      expect(updatedUserId).toBe('user-a');
      expect(updatedData.default_btc_account_id).toBe('acct-1');
    });
  });
});
