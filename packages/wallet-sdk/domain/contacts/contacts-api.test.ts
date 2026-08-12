import { describe, expect, it } from 'bun:test';
import type { AgicashDb } from '../../db/database';
import { NoSessionError, SessionEndedError } from '../../lib/error';
import type { AuthSession, AuthUser } from '../sdk';
import { createSessionKeys } from '../sdk/session-keys';
import type { Contact } from './contact';
import type { ContactRepository } from './contact-repository';
import { createContactsApi } from './contacts-api';

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

const makeContact = (overrides: Partial<Contact> = {}): Contact => ({
  id: 'contact-1',
  createdAt: '2026-01-01T00:00:00Z',
  username: 'satoshi',
  lud16: 'satoshi@agi.cash',
  ...overrides,
});

const makeApi = (deps: {
  session: AuthSession;
  repository?: Partial<ContactRepository>;
}) =>
  createContactsApi({
    db: {} as unknown as AgicashDb,
    keys: createSessionKeys(),
    getSession: () => deps.session,
    lightningAddressDomain: 'agi.cash',
    createRepository: () =>
      (deps.repository ?? {}) as unknown as ContactRepository,
  });

describe('createContactsApi', () => {
  describe('list', () => {
    it('lists the session user contacts', async () => {
      let requestedUserId: string | undefined;
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          getAll: (async (userId: string) => {
            requestedUserId = userId;
            return [
              makeContact(),
              makeContact({ id: 'contact-2', username: 'hal' }),
            ];
          }) as ContactRepository['getAll'],
        },
      });

      const contacts = await api.list();

      expect(requestedUserId).toBe('user-x');
      expect(contacts).toHaveLength(2);
      expect(contacts[0]).toEqual(makeContact());
    });

    it('throws NoSessionError without a session', async () => {
      const api = makeApi({ session: { isLoggedIn: false } });
      await expect(api.list()).rejects.toBeInstanceOf(NoSessionError);
    });

    it('rejects with SessionEndedError and issues no read after dispose', async () => {
      const keys = createSessionKeys();
      let getAllCalls = 0;
      const api = createContactsApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        lightningAddressDomain: 'agi.cash',
        createRepository: () =>
          ({
            getAll: (async () => {
              getAllCalls += 1;
              return [];
            }) as ContactRepository['getAll'],
          }) as unknown as ContactRepository,
      });

      keys.dispose();

      await expect(api.list()).rejects.toBeInstanceOf(SessionEndedError);
      expect(getAllCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the read', async () => {
      const keys = createSessionKeys();
      const api = createContactsApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        lightningAddressDomain: 'agi.cash',
        createRepository: () =>
          ({
            getAll: (async () => {
              keys.reset();
              return [makeContact()];
            }) as ContactRepository['getAll'],
          }) as unknown as ContactRepository,
      });

      await expect(api.list()).rejects.toBeInstanceOf(SessionEndedError);
    });
  });

  describe('get', () => {
    it('returns the contact', async () => {
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          get: (async () => makeContact()) as ContactRepository['get'],
        },
      });

      const contact = await api.get('contact-1');

      expect(contact).toEqual(makeContact());
    });

    it('returns null when the contact does not exist', async () => {
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          get: (async () => null) as ContactRepository['get'],
        },
      });

      await expect(api.get('missing')).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('injects the session userId as ownerId and returns the contact', async () => {
      let created: Record<string, unknown> | undefined;
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          create: (async (input: Record<string, unknown>) => {
            created = input;
            return makeContact();
          }) as unknown as ContactRepository['create'],
        },
      });

      const contact = await api.create({ username: 'satoshi' });

      expect(created?.ownerId).toBe('user-x');
      expect(created?.username).toBe('satoshi');
      expect(contact).toEqual(makeContact());
    });

    it('throws NoSessionError without a session', async () => {
      const api = makeApi({ session: { isLoggedIn: false } });
      await expect(api.create({ username: 'x' })).rejects.toBeInstanceOf(
        NoSessionError,
      );
    });
  });

  describe('delete', () => {
    it('delegates to the repository with the contact id', async () => {
      let deletedId: string | undefined;
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          delete: (async (contactId: string) => {
            deletedId = contactId;
          }) as ContactRepository['delete'],
        },
      });

      await api.delete('contact-1');

      expect(deletedId).toBe('contact-1');
    });
  });

  describe('findContactCandidates', () => {
    it('passes the query and session userId and returns profiles verbatim', async () => {
      let args: { query?: string; userId?: string } = {};
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          findContactCandidates: (async (query: string, userId: string) => {
            args = { query, userId };
            return [{ id: 'user-2', username: 'hal' }];
          }) as ContactRepository['findContactCandidates'],
        },
      });

      const candidates = await api.findContactCandidates('ha');

      expect(args).toEqual({ query: 'ha', userId: 'user-x' });
      expect(candidates).toEqual([{ id: 'user-2', username: 'hal' }]);
    });

    it('throws NoSessionError without a session', async () => {
      const api = makeApi({ session: { isLoggedIn: false } });
      await expect(api.findContactCandidates('ha')).rejects.toBeInstanceOf(
        NoSessionError,
      );
    });
  });
});
