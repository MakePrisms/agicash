import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { useSdk } from '~/features/shared/use-sdk';
import { useUser } from '../user/user-hooks';
import type { Contact } from './contact';
export class ContactsCache {
  public static Key = 'contacts';

  constructor(private readonly queryClient: QueryClient) {}

  /**
   * Adds a contact to the cache.
   * @param contact - The contact to add.
   */
  add(contact: Contact) {
    this.queryClient.setQueryData<Contact[]>([ContactsCache.Key], (curr) => [
      ...(curr ?? []),
      contact,
    ]);
  }

  /**
   * Gets all contacts in the cache for the current user.
   * @returns The list of contacts.
   */
  getAll() {
    return this.queryClient.getQueryData<Contact[]>([ContactsCache.Key]);
  }

  /**
   * Get a contact by id.
   * @param id - The id of the contact.
   * @returns The contact or null if the contact is not found.
   */
  get(id: string) {
    const contacts = this.getAll();
    return contacts?.find((x) => x.id === id) ?? null;
  }

  /**
   * Removes a contact from the cache.
   * @param contactId - The id of the contact to remove.
   */
  remove(contactId: string) {
    this.queryClient.setQueryData<Contact[]>(
      [ContactsCache.Key],
      (curr) => curr?.filter((x) => x.id !== contactId) ?? [],
    );
  }

  /**
   * Invalidates the contacts cache.
   */
  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [ContactsCache.Key],
    });
  }
}

export function useContactsCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new ContactsCache(queryClient), [queryClient]);
}

/**
 * Hook for listing contacts for the current user with optional filtering
 */
export function useContacts(select?: (contacts: Contact[]) => Contact[]) {
  useUser(); // gate: suspend until the session resolves (SDK self-resolves the userId)
  const sdk = useSdk();

  const { data: contacts } = useSuspenseQuery({
    queryKey: [ContactsCache.Key],
    queryFn: async () => (await sdk).contacts.list(),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    select,
  });

  return contacts;
}

export function useContact(contactId: string) {
  const contacts = useContacts();
  const contact = contacts.find((contact) => contact.id === contactId);
  if (!contact) {
    return null;
  }
  return contact;
}

export function useCreateContact() {
  const sdkPromise = useSdk();

  const { mutateAsync: createContact } = useMutation({
    mutationKey: ['create-contact'],
    mutationFn: async ({ username }: { username: string }) =>
      (await sdkPromise).contacts.add({ username }),
  });

  return createContact;
}

export function useDeleteContact() {
  const sdkPromise = useSdk();

  const { mutateAsync: deleteContact } = useMutation({
    mutationKey: ['delete-contact'],
    mutationFn: async (contact: Contact) =>
      (await sdkPromise).contacts.remove(contact),
  });

  return deleteContact;
}

/**
 * @param query - The search query string
 * @return the query response containing any user profiles that match the query
 */
export function useFindContactCandidates(query: string) {
  useUser(); // gate: suspend until the session resolves (SDK self-resolves the userId)
  const sdk = useSdk();

  return useQuery({
    queryKey: ['search-user-profiles', query],
    queryFn: async () => (await sdk).contacts.search({ query }),
    initialData: [],
    initialDataUpdatedAt: () => Date.now() - 1000 * 6,
    staleTime: 1000 * 5,
  });
}
