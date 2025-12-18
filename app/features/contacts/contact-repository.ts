import useLocationData from '~/hooks/use-location';
import type { AgicashDb, AgicashDbContact } from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import type { UserProfile } from '../user/user';
import type { Contact } from './contact';

type CreateContact = {
  /** Id of the user creating the contact */
  ownerId: string;
  /** Username of the user within this app to add as a contact */
  username: string;
};

export class ContactRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly domain: string,
  ) {}

  async get(contactId: string) {
    const query = this.db.from('contacts').select().eq('id', contactId);

    const { data, error } = await query.single();

    if (error) {
      throw new Error('Failed to get contact', error);
    }

    return ContactRepository.toContact(data, this.domain);
  }

  /**
   * Gets all contacts for a user
   * @param ownerId - The ID of the user whose contacts to fetch
   * @returns Array of contacts
   */
  async getAll(
    ownerId: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Contact[]> {
    const query = this.db
      .from('contacts')
      .select()
      .eq('owner_id', ownerId)
      .limit(150)
      .order('username', { ascending: true }); // sort alphabetically

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to get contacts', error);
    }

    return data.map((contact) =>
      ContactRepository.toContact(contact, this.domain),
    );
  }

  /**
   * Creates a new contact for a user
   * @param ownerId - The ID of the user who owns the contact
   * @param contact - The contact data to create
   * @returns The created contact
   */
  async create(
    contact: CreateContact,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Contact> {
    const query = this.db
      .from('contacts')
      .insert({
        owner_id: contact.ownerId,
        username: contact.username,
      })
      .select();

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.single();

    if (error) {
      throw new Error('Failed to create contact', error);
    }

    return ContactRepository.toContact(data, this.domain);
  }

  /**
   * Deletes a contact
   * @param contactId - The ID of the contact to delete
   */
  async delete(
    contactId: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<void> {
    const query = this.db.from('contacts').delete().eq('id', contactId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw new Error('Failed to delete contact', error);
    }
  }

  /**
   * Search for user profiles by partial username, excluding existing contacts
   * @param query - The partial username to search for
   * @param currentUserId - The ID of the current user
   * @returns Array of user profiles that are not already contacts of the current user
   */
  async findContactCandidates(
    query: string,
    currentUserId: string,
    options?: { abortSignal?: AbortSignal; sort?: 'desc' | 'asc' },
  ): Promise<UserProfile[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) {
      return [];
    }

    const rpcQuery = this.db.rpc('find_contact_candidates', {
      partial_username: trimmedQuery,
      current_user_id: currentUserId,
    });

    if (options?.abortSignal) {
      rpcQuery.abortSignal(options.abortSignal);
    }

    const { data, error } = await rpcQuery;

    if (error) {
      throw new Error('Failed to search users', error);
    }

    return data;
  }

  /**
   * Converts a database contact record to a Contact object
   */
  static toContact(dbContact: AgicashDbContact, domain: string): Contact {
    return {
      id: dbContact.id,
      createdAt: dbContact.created_at,
      ownerId: dbContact.owner_id,
      username: dbContact.username ?? '',
      lud16: `${dbContact.username}@${domain}`,
    };
  }
}

export function useContactRepository() {
  const { domain } = useLocationData();
  return new ContactRepository(agicashDbClient, domain);
}
