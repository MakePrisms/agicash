import type { AgicashDb } from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import type { UserProfile } from '../user/user';
import type { Contact } from './contact';
import { ContactRepository } from './contact-repository';
import { ContactsCache, createContactChangeHandlers } from './contacts-cache';

export type ContactsApi = {
  /**
   * Query config for the current user's contact list (consume with
   * useSuspenseQuery).
   */
  listOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<Contact[]>;
    staleTime: number;
  };
  /** The contact from the in-memory contacts state, or null. */
  getCached: (id: string) => Contact | null;
  /**
   * Creates a contact for the current user. The new contact is recorded in
   * the contacts state by the CONTACT_CREATED realtime broadcast, not here.
   * @throws DomainError when the contact limit is reached.
   */
  create: (params: { username: string }) => Promise<Contact>;
  /** Deletes the contact. The state update arrives via CONTACT_DELETED. */
  delete: (contactId: string) => Promise<void>;
  /**
   * Query config for searching user profiles by partial username, excluding
   * existing contacts. Below 3 characters the search returns no results.
   */
  findCandidatesOptions: (query: string) => {
    queryKey: string[];
    queryFn: () => Promise<UserProfile[]>;
  };
};

export type ContactsApiDeps = {
  queryClient: QueryClient;
  db: AgicashDb;
  /**
   * Resolves the current user's id from the SDK's user state.
   * @throws if no user is loaded yet.
   */
  getCurrentUserId: () => string;
  /**
   * The domain used to build contact lightning addresses (lud16). A thunk
   * because the host resolves it from its environment at call time.
   */
  getDomain: () => string;
};

export function createContactsApi(deps: ContactsApiDeps): {
  api: ContactsApi;
  cache: ContactsCache;
  changeHandlers: ReturnType<typeof createContactChangeHandlers>;
} {
  const { queryClient, db, getCurrentUserId, getDomain } = deps;

  // Safe to resolve here: domains are constructed lazily on first getSdk(),
  // which is client-only, and the host domain is fixed for the session.
  const repository = new ContactRepository(db, getDomain());
  const cache = new ContactsCache(queryClient);

  const api: ContactsApi = {
    listOptions: () => ({
      queryKey: [ContactsCache.Key],
      queryFn: () => repository.getAll(getCurrentUserId()),
      staleTime: Number.POSITIVE_INFINITY,
    }),
    getCached: (id: string) => cache.get(id),
    create: (params: { username: string }) =>
      repository.create({
        ownerId: getCurrentUserId(),
        username: params.username,
      }),
    delete: (contactId: string) => repository.delete(contactId),
    findCandidatesOptions: (query: string) => ({
      queryKey: ['search-user-profiles', query],
      queryFn: () =>
        repository.findContactCandidates(query, getCurrentUserId()),
    }),
  };

  return {
    api,
    cache,
    changeHandlers: createContactChangeHandlers(cache, getDomain),
  };
}
