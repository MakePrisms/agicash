/**
 * `ContactsDomain` implementation — §8 of the contract, Slice 4 (reactive overlay, design B).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/contacts/contact-hooks.ts` (`useContacts` / `useContact` /
 * `useCreateContact` / `useDeleteContact` / `useFindContactCandidates`) + `contact-repository.ts`.
 * Master expresses these as React hooks over a TanStack `ContactsCache`.
 *
 * REACTIVE OVERLAY: TanStack is no longer in the consumer — it is hidden inside the SDK.
 *  - `list()` / `get(id)` are OBSERVABLE FETCHES → each returns a `Query<T>`. The fetch body is
 *    the no-cache read (the repository `getAll` / a row lookup, scoped to the resolved user),
 *    wrapped via {@link toQuery} over the SDK-internal `QueryClient` and MEMOISED per key (`#q`)
 *    so repeated calls return the SAME stable `Query` ref (`get` memoised per id). Realtime
 *    (Slice 5) writes the same client to push fresh values / invalidate these keys when a
 *    `contact:*` change arrives.
 *  - `add(params)` CREATES; `remove(contact)` takes the FULL object; `search({ query })` is a
 *    ONE-SHOT search (min-3, excludes existing) → all stay `Promise` (lifted verbatim).
 *
 * Two-mode API rule (Josip 6/01): `list`/`get` are observable fetches, `search` a one-shot fetch;
 * `add` CREATES (params); `remove` takes the FULL contact object (user-invoked).
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
import { type QueryClient, toQuery } from '../query';
import type { Contact } from '../types/contact';
import type { Query } from '../types/query';
import type { UserProfile } from '../types/user';

/** Stable query-key prefix for the saved-contacts list. */
const CONTACTS_KEY = 'contacts';
/** Stable query-key prefix for a single contact by id. */
const CONTACT_KEY = 'contact';

/**
 * The contacts domain. Construct with the SDK-internal `QueryClient` (backs the observable
 * reads), the contact repository (DB read/write), and the session resolver (current user id —
 * contacts are owned/searched per user).
 */
export class ContactsDomainImpl implements ContactsDomain {
  /**
   * Per-key memo of the `Query` handles this domain exposes, so repeated calls with the same
   * arguments return the SAME stable reference. Hidden inside the SDK.
   */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Query<T> memo, keyed by string
  readonly #q = new Map<string, Query<any>>();

  /**
   * @param client - the SDK-internal TanStack `QueryClient` (never exposed to consumers).
   * @param contacts - the `wallet.contacts` repository (holds the SDK Supabase client + domain).
   * @param session - resolves the current user (id).
   */
  constructor(
    private readonly client: QueryClient,
    private readonly contacts: ContactRepository,
    private readonly session: SessionResolver,
  ) {}

  /**
   * Memoise a `Query` per stringified key: the FIRST call for a key builds the `Query` via
   * {@link toQuery}; later calls return the same stable ref. Mirrors the per-key-memo the other
   * reactive domains use (e.g. `accounts.list`).
   */
  #memo<T>(key: readonly unknown[], fn: () => Promise<T>): Query<T> {
    const id = JSON.stringify(key);
    let q = this.#q.get(id);
    if (!q) {
      q = toQuery<T>(this.client, key, fn);
      this.#q.set(id, q);
    }
    return q;
  }

  /**
   * All of the user's saved contacts, alphabetical by username — as an observable {@link Query}.
   * Re-houses master `useContacts` / `getAll`. Wrapped in a {@link toQuery}-backed `Query`,
   * memoised per key.
   *
   * @returns a stable `Query<Contact[]>`.
   */
  list(): Query<Contact[]> {
    return this.#memo([CONTACTS_KEY], async () => {
      const user = await this.session.requireCurrentUser();
      return this.contacts.getAll(user.id);
    });
  }

  /**
   * The saved contact with this id, or `null` — as an observable {@link Query}. Re-houses master
   * `useContact` (which finds it in the contacts list); here the fetch body reads the row
   * directly, returning null when not found (master's repository `get` throws on a missing row;
   * the contract returns null). Memoised per id.
   *
   * @param id - the contact id.
   * @returns a stable `Query<Contact | null>`.
   */
  get(id: string): Query<Contact | null> {
    return this.#memo([CONTACT_KEY, id], async () => {
      try {
        return await this.contacts.get(id);
      } catch {
        return null;
      }
    });
  }

  /**
   * Add a contact by username (create). Re-houses master `useCreateContact` →
   * `contact-repository.create` (owned by the current user). The `contact:created` event is
   * forwarded from the realtime broadcast, not emitted here. An ACTION → `Promise`.
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
   * broadcast, not emitted here. An ACTION → `Promise`.
   *
   * @param contact - the contact to remove.
   */
  async remove(contact: Contact): Promise<void> {
    await this.contacts.delete(contact.id);
  }

  /**
   * Search addable user profiles by query (ONE-SHOT fetch → `Promise`). Re-houses master
   * `useFindContactCandidates` → `findContactCandidates`: minimum 3 characters (shorter queries
   * return `[]`), and the current user's existing contacts are excluded (the
   * `find_contact_candidates` RPC does both).
   *
   * @param params - `{ query }` (the partial username).
   * @returns the matching addable profiles (empty for queries under 3 chars).
   */
  async search(params: { query: string }): Promise<UserProfile[]> {
    const user = await this.session.requireCurrentUser();
    return this.contacts.findContactCandidates(params.query, user.id);
  }
}
