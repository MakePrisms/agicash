import type { Contact } from '@agicash/wallet-sdk/contacts/contact';
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { getSdk } from '~/features/shared/sdk';

export { ContactsCache } from '@agicash/wallet-sdk';

/**
 * Hook for listing contacts for the current user with optional filtering
 */
export function useContacts(select?: (contacts: Contact[]) => Contact[]) {
  const { data: contacts } = useSuspenseQuery({
    ...getSdk().contacts.listOptions(),
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
      getSdk().contacts.create({ username }),
  });

  return createContact;
}

export function useDeleteContact() {
  const { mutateAsync: deleteContact } = useMutation({
    mutationKey: ['delete-contact'],
    mutationFn: (contactId: string) => getSdk().contacts.delete(contactId),
  });

  return deleteContact;
}

/**
 * @param query - The search query string
 * @return the query response containing any user profiles that match the query
 */
export function useFindContactCandidates(query: string) {
  return useQuery({
    ...getSdk().contacts.findCandidatesOptions(query),
    initialData: [],
    initialDataUpdatedAt: () => Date.now() - 1000 * 6,
    staleTime: 1000 * 5,
  });
}
