import { describe, expect, it } from 'bun:test';
import type { AgicashDb } from '../../db/database';
import type { AuthUser } from '../../sdk';
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

describe('createUserApi', () => {
  describe('setDefaultAccount', () => {
    it('writes onto the user that validated account ownership, not the current session user', async () => {
      let sessionUserId = 'user-a';
      let updatedUserId: unknown;
      let updatedData: Record<string, unknown> = {};
      const api = createUserApi({
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
      });

      await api.setDefaultAccount({ accountId: 'acct-1' });

      expect(updatedUserId).toBe('user-a');
      expect(updatedData.default_btc_account_id).toBe('acct-1');
    });
  });
});
