import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getSdk } from '~/lib/sdk';
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
  const { data: contacts } = useSuspenseQuery({
    queryKey: [ContactsCache.Key],
    queryFn: () => getSdk().contacts.list(),
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
  const { mutateAsync: createContact } = useMutation({
    mutationKey: ['create-contact'],
    mutationFn: ({ username }: { username: string }) =>
      getSdk().contacts.add({ username }),
  });

  return createContact;
}

export function useDeleteContact() {
  const { mutateAsync: deleteContact } = useMutation({
    mutationKey: ['delete-contact'],
    mutationFn: (contactId: string) => getSdk().contacts.remove(contactId),
  });

  return deleteContact;
}

/**
 * @param query - The search query string
 * @return the query response containing any user profiles that match the query
 */
export function useFindContactCandidates(query: string) {
  return useQuery({
    queryKey: ['search-user-profiles', query],
    queryFn: () => getSdk().contacts.search(query),
    initialData: [],
    initialDataUpdatedAt: () => Date.now() - 1000 * 6,
    staleTime: 1000 * 5,
  });
}

export function useWireContactEvents() {
  const contactsCache = useContactsCache();

  useEffect(() => {
    const sdk = getSdk();
    const unsubscribers = [
      sdk.on('contact:created', ({ entity }) => {
        contactsCache.add(entity);
      }),
      sdk.on('contact:deleted', ({ id }) => {
        contactsCache.remove(id);
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [contactsCache]);
}
