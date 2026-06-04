/**
 * `ContactsDomain` implementation — §8 of the contract, Slice 4.
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/contacts/contact-hooks.ts` (`useContacts` / `useContact` /
 * `useCreateContact` / `useDeleteContact` / `useFindContactCandidates`) + `contact-repository.ts`.
 * Master expresses these as React hooks over a TanStack `ContactsCache`; the SDK exposes them as
 * plain async methods over the SDK-owned repository (no cache — events drive the consumer).
 *
 * Two-mode API rule (Josip 6/01): `list`/`get`/`search` are FETCHES; `add` CREATES (params);
 * `remove` takes the FULL contact object (user-invoked).
 *
 * Events: `contact:created`/`contact:deleted` are NOT emitted from these mutations — they are
 * forwarded from the realtime DB-change broadcast (the single event source, like master's
 * `CONTACT_CREATED`/`CONTACT_DELETED` trigger), via `internal/contact-event-forwarder.ts` (shape
 * defined here, channel wired in Slice 5) — so `add`/`remove` never double-emit.
 *
 * @module
 */
import type { ContactRepository } from '../internal/contact-repository';
import type { SessionResolver } from '../internal/session';
import type { ContactsDomain } from '../domains';
import type { Contact, UserProfile } from '../types/contact';

/**
 * The contacts domain. Construct with the contact repository (DB read/write) and the session
 * resolver (current user id — contacts are owned/searched per user).
 */
export class ContactsDomainImpl implements ContactsDomain {
  /**
   * @param contacts - the `wallet.contacts` repository (holds the SDK Supabase client + domain).
   * @param session - resolves the current user (id).
   */
  constructor(
    private readonly contacts: ContactRepository,
    private readonly session: SessionResolver,
  ) {}

  /**
   * All of the user's saved contacts, alphabetical by username (fetch). Re-houses master
   * `useContacts` / `getAll`.
   *
   * @returns the contacts.
   */
  async list(): Promise<Contact[]> {
    const user = await this.session.requireCurrentUser();
    return this.contacts.getAll(user.id);
  }

  /**
   * Fetch a saved contact by id, or null (fetch). Re-houses master `useContact` (which finds it
   * in the contacts list); here it reads the row directly, returning null when not found.
   *
   * @param id - the contact id.
   * @returns the contact, or null.
   */
  async get(id: string): Promise<Contact | null> {
    try {
      return await this.contacts.get(id);
    } catch {
      // Master's repository `get` throws on a missing row; the contract returns null.
      return null;
    }
  }

  /**
   * Add a contact by username (create). Re-houses master `useCreateContact` →
   * `contact-repository.create` (owned by the current user). The `contact:created` event is
   * forwarded from the realtime broadcast, not emitted here.
   *
   * @param params - `{ username }` of the Agicash user to add.
   * @returns the created contact.
   * @throws DomainError if the user's contact limit is reached.
   */
  async add(params: { username: string }): Promise<Contact> {
    const user = await this.session.requireCurrentUser();
    return this.contacts.create({
      ownerId: user.id,
      username: params.username,
    });
  }

  /**
   * Remove a saved contact (FULL object). Re-houses master `useDeleteContact` →
   * `contact-repository.delete`. The `contact:deleted` event is forwarded from the realtime
   * broadcast, not emitted here.
   *
   * @param contact - the contact to remove.
   */
  async remove(contact: Contact): Promise<void> {
    await this.contacts.delete(contact.id);
  }

  /**
   * Search addable user profiles by query (fetch). Re-houses master `useFindContactCandidates` →
   * `findContactCandidates`: minimum 3 characters (shorter queries return `[]`), and the current
   * user's existing contacts are excluded (the `find_contact_candidates` RPC does both).
   *
   * @param params - `{ query }` (the partial username).
   * @returns the matching addable profiles (empty for queries under 3 chars).
   */
  async search(params: { query: string }): Promise<UserProfile[]> {
    const user = await this.session.requireCurrentUser();
    return this.contacts.findContactCandidates(params.query, user.id);
  }
}
