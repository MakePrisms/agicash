/**
 * Contact domain types — §8 of the contract, Slice 4.
 *
 * Lifted VERBATIM from master `app/features/contacts/contact.ts` (`ContactSchema`, a
 * `zod/mini` `z.infer`) + `app/features/user/user.ts` (`UserProfile`). The SDK owns the
 * runtime schema single-source via `internal/lib-contacts` (`ContactSchema`); these are the
 * matching public `z.infer` shapes.
 *
 * CONTACT DRIFT RECONCILIATION (Josip's keep-verbatim ruling — MASTER WINS over the earlier
 * contract §8 draft, which had drifted): all three now match master exactly:
 *  - `Contact.createdAt` is a `string` (ISO 8601), NOT a `Date`.
 *  - `UserProfile = Pick<User, 'id' | 'username'>` — it does NOT carry `lud16`.
 *  - `lud16` is COMPUTED at runtime as `` `${username}@${domain}` `` (a derived field set by the
 *    repository's `toContact`, NOT a stored column). The `domain` comes from `SdkConfig.domain`
 *    (re-housed off master's `useLocationData().domain`).
 *
 * Contacts have NO `version` column (CREATE/DELETE only, never UPDATE) → ordering/dedupe is by
 * op-type + refetch (§8), not optimistic version.
 */
import type { User } from './user';

/**
 * A saved contact — another Agicash user the owner can pay. CREATE/DELETE only (no `version`
 * column), so ordering/dedupe is by op-type + refetch.
 */
export type Contact = {
  /** UUID of the contact row. */
  id: string;
  /** When the contact was created, in ISO 8601 format. */
  createdAt: string;
  /** Id of the user that this contact belongs to. */
  ownerId: string;
  /** Username of the user within this app that this contact references. */
  username: string;
  /**
   * Lightning Address of the user that this contact references. COMPUTED at runtime as
   * `` `${username}@${domain}` `` — not a stored column.
   */
  lud16: string;
};

/**
 * A public, addable user profile returned by {@link ContactsDomain.search} (before it becomes a
 * saved {@link Contact}). `Pick<User, 'id' | 'username'>` — master verbatim; carries no `lud16`.
 */
export type UserProfile = Pick<User, 'id' | 'username'>;
