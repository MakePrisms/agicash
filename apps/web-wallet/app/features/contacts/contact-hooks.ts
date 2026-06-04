import { useQ, useSdk } from '@agicash/react-wallet-sdk';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Contact } from './contact';

/**
 * Hook for listing contacts for the current user with optional filtering.
 *
 * Returns the array directly (suspends while loading).
 */
export function useContacts(
  select?: (contacts: Contact[]) => Contact[],
): Contact[] {
  const sdk = useSdk();
  // The SDK and web `Contact` types are structurally equivalent at runtime; the
  // web's is a zod-narrowed mirror of the SDK's plain type.
  const contacts = useQ(sdk.contacts.list()) as unknown as Contact[];
  return select ? select(contacts) : contacts;
}

export function useContact(contactId: string): Contact | null {
  const sdk = useSdk();
  const contact = useQ(sdk.contacts.get(contactId));
  return contact as unknown as Contact | null;
}

export function useCreateContact() {
  const sdk = useSdk();

  const { mutateAsync: createContact } = useMutation({
    mutationKey: ['create-contact'],
    mutationFn: ({ username }: { username: string }) =>
      sdk.contacts.add({ username }),
    onSuccess: () => {
      void sdk.contacts.list().refetch();
    },
  });

  return createContact;
}

export function useDeleteContact() {
  const sdk = useSdk();

  const { mutateAsync: deleteContact } = useMutation({
    mutationKey: ['delete-contact'],
    mutationFn: (contact: Contact) =>
      sdk.contacts.remove(
        contact as unknown as Parameters<typeof sdk.contacts.remove>[0],
      ),
    onSuccess: () => {
      void sdk.contacts.list().refetch();
    },
  });

  return deleteContact;
}

/**
 * @param query - The search query string
 * @return the query response containing any user profiles that match the query
 */
export function useFindContactCandidates(query: string) {
  const sdk = useSdk();

  return useQuery({
    queryKey: ['search-user-profiles', query],
    queryFn: () => sdk.contacts.search({ query }),
    initialData: [],
    initialDataUpdatedAt: () => Date.now() - 1000 * 6,
    staleTime: 1000 * 5,
  });
}
