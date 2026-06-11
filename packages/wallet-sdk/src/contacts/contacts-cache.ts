import type { AgicashDbContact } from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import type { Contact } from './contact';
import { ContactRepository } from './contact-repository';

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

/**
 * Realtime contact change handlers. Contact creation is recorded here (not in
 * the create call) — the CONTACT_CREATED broadcast is the single write path.
 */
export function createContactChangeHandlers(
  cache: ContactsCache,
  getDomain: () => string,
) {
  return [
    {
      event: 'CONTACT_CREATED',
      handleEvent: async (payload: AgicashDbContact) => {
        const contact = ContactRepository.toContact(payload, getDomain());
        cache.add(contact);
      },
    },
    {
      event: 'CONTACT_DELETED',
      handleEvent: async (payload: AgicashDbContact) => {
        cache.remove(payload.id);
      },
    },
  ];
}
