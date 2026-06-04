/**
 * Internal `wallet.contacts` repository — Slice 4 (contacts).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/contacts/contact-repository.ts`. Master's `ContactRepository` is
 * ALREADY a plain class taking `(db, domain)` — only the `useContactRepository()` factory (which
 * reads `agicashDbClient` + `useLocationData().domain`) couples it to React. Here it takes the
 * SDK-owned Supabase client + the `domain` from {@link SdkConfig} (re-housed off the hook). All
 * query logic — `get` / `getAll` (alpha-sorted, limit 150) / `create` / `delete` /
 * `findContactCandidates` (the `find_contact_candidates` RPC) — is verbatim from master.
 *
 * `toContact` computes the contact's `lud16` as `` `${username}@${domain}` `` at runtime (the
 * CONTACT DRIFT reconciliation — `lud16` is NOT a stored column, `createdAt` is the ISO string
 * straight off the row). Contacts have no `version` column.
 *
 * @module
 */
import { DomainError } from '../errors';
import type { AgicashDbContact } from './db-contact';
import type { WalletSupabaseClient } from './supabase-client';
import type { Contact } from '../types/contact';
import type { UserProfile } from '../types/user';

/** Per-call query options (an abort signal, matching master). */
type Options = { abortSignal?: AbortSignal };

/** Params for {@link ContactRepository.create} (master `CreateContact`). */
type CreateContact = {
  /** Id of the user creating the contact. */
  ownerId: string;
  /** Username of the user within this app to add as a contact. */
  username: string;
};

/**
 * Reads + writes for the `wallet.contacts` table, scoped (via RLS) to the signed-in user. Holds
 * the SDK-owned Supabase client + the Agicash `domain` used to compute each contact's `lud16`.
 */
export class ContactRepository {
  /**
   * @param db - the SDK-owned Supabase client (schema pinned to `wallet`).
   * @param domain - the Agicash Lightning-address domain (for `lud16`); empty string if unset.
   */
  constructor(
    private readonly db: WalletSupabaseClient,
    private readonly domain: string,
  ) {}

  /**
   * Get the contact with the given id.
   *
   * Verbatim logic from master `ContactRepository.get`.
   *
   * @param contactId - the contact id.
   * @returns the contact.
   * @throws Error if the read fails (master throws on not-found too).
   */
  async get(contactId: string): Promise<Contact> {
    const query = this.db.from('contacts').select().eq('id', contactId);

    const { data, error } = await query.single();

    if (error) {
      throw new Error('Failed to get contact', { cause: error });
    }

    return ContactRepository.toContact(data as AgicashDbContact, this.domain);
  }

  /**
   * Get all contacts for a user, alphabetically by username (limit 150).
   *
   * Verbatim logic from master `ContactRepository.getAll`.
   *
   * @param ownerId - the id of the user whose contacts to fetch.
   * @param options - optional abort signal.
   * @returns the contacts.
   * @throws Error if the read fails.
   */
  async getAll(ownerId: string, options?: Options): Promise<Contact[]> {
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
      throw new Error('Failed to get contacts', { cause: error });
    }

    return (data as AgicashDbContact[]).map((contact) =>
      ContactRepository.toContact(contact, this.domain),
    );
  }

  /**
   * Create a new contact for a user.
   *
   * Verbatim logic from master `ContactRepository.create`.
   *
   * @param contact - `{ ownerId, username }`.
   * @param options - optional abort signal.
   * @returns the created contact.
   * @throws DomainError if the user's contact limit is reached.
   * @throws Error if the insert otherwise fails.
   */
  async create(contact: CreateContact, options?: Options): Promise<Contact> {
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
      if (error.hint === 'LIMIT_REACHED') {
        throw new DomainError(`${error.message} ${error.details ?? ''}`.trim());
      }

      throw new Error('Failed to create contact', { cause: error });
    }

    return ContactRepository.toContact(data as AgicashDbContact, this.domain);
  }

  /**
   * Delete a contact.
   *
   * Verbatim logic from master `ContactRepository.delete`.
   *
   * @param contactId - the id of the contact to delete.
   * @param options - optional abort signal.
   * @throws Error if the delete fails.
   */
  async delete(contactId: string, options?: Options): Promise<void> {
    const query = this.db.from('contacts').delete().eq('id', contactId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw new Error('Failed to delete contact', { cause: error });
    }
  }

  /**
   * Search for user profiles by partial username, EXCLUDING the current user's existing
   * contacts. Returns an empty array for queries shorter than 3 characters (after trim).
   *
   * Verbatim logic from master `ContactRepository.findContactCandidates` (the
   * `find_contact_candidates` RPC).
   *
   * @param query - the partial username to search for.
   * @param currentUserId - the id of the current user (its contacts are excluded).
   * @param options - optional abort signal.
   * @returns the matching addable user profiles.
   * @throws Error if the search fails.
   */
  async findContactCandidates(
    query: string,
    currentUserId: string,
    options?: Options,
  ): Promise<UserProfile[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) {
      return [];
    }

    // The `find_contact_candidates` RPC lives in the stored procedure, not the untyped client's
    // type space — cast the call (matching the other repos).
    // biome-ignore lint/suspicious/noExplicitAny: see above.
    let rpcQuery = (this.db.rpc as any)('find_contact_candidates', {
      partial_username: trimmedQuery,
      current_user_id: currentUserId,
    });

    if (options?.abortSignal) {
      rpcQuery = rpcQuery.abortSignal(options.abortSignal);
    }

    const { data, error } = await rpcQuery;

    if (error) {
      throw new Error('Failed to search users', { cause: error });
    }

    return data as UserProfile[];
  }

  /**
   * Map a `wallet.contacts` DB row to the domain {@link Contact}, computing `lud16` as
   * `` `${username}@${domain}` `` (the runtime-derived field — CONTACT DRIFT reconciliation).
   * Verbatim from master `ContactRepository.toContact`.
   *
   * @param dbContact - the contact row.
   * @param domain - the Agicash Lightning-address domain.
   * @returns the domain contact.
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
