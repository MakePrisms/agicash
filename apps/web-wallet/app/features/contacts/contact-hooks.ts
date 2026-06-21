import { useMutation, useQuery } from '@tanstack/react-query';
import { getSdk } from '~/lib/sdk';
import { useStoreSelect } from '~/lib/store-hooks';
import type { Contact } from './contact';

/**
 * Hook for listing contacts for the current user with optional filtering.
 * Reads from the `sdk.contacts.all` store; suspends until the store loads.
 */
export function useContacts(select?: (contacts: Contact[]) => Contact[]) {
  return useStoreSelect(getSdk().contacts.all, select ?? ((c) => c));
}

export function useContact(contactId: string) {
  return useStoreSelect(
    getSdk().contacts.all,
    (cs) => cs.find((c) => c.id === contactId) ?? null,
  );
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
