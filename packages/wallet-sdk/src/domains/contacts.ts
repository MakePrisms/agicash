import type { ContactRepository } from '../internal/db/contact-repository';
import type { Contact } from './contact';
import type { UserProfile } from './user-types';

type Deps = {
  contactRepository: ContactRepository;
  /** Resolves the current user's id, or null when signed out. */
  getCurrentUserId: () => Promise<string | null>;
};

/**
 * The `contacts` domain: add/remove a contact, fetch one by id, search for
 * candidate users to add, and list all contacts.
 */
export class ContactsDomain {
  constructor(private readonly deps: Deps) {}

  /** All contacts for the current user. */
  async list(): Promise<Contact[]> {
    return this.deps.contactRepository.getAll(await this.requireUserId());
  }

  /** A single contact by id. Throws if not found. */
  get(contactId: string): Promise<Contact> {
    return this.deps.contactRepository.get(contactId);
  }

  /** Adds a contact (by app username) for the current user. */
  async add(params: { username: string }): Promise<Contact> {
    const ownerId = await this.requireUserId();
    return this.deps.contactRepository.create({
      ownerId,
      username: params.username,
    });
  }

  /** Removes a contact by id. */
  remove(contactId: string): Promise<void> {
    return this.deps.contactRepository.delete(contactId);
  }

  /**
   * Searches for users to add as contacts, excluding existing contacts. Returns
   * an empty array for queries shorter than 3 trimmed characters.
   */
  async search(
    query: string,
    options?: { abortSignal?: AbortSignal; sort?: 'desc' | 'asc' },
  ): Promise<UserProfile[]> {
    const currentUserId = await this.requireUserId();
    return this.deps.contactRepository.findContactCandidates(
      query,
      currentUserId,
      options,
    );
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
