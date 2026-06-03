/**
 * Contact domain types — §8 of the contract.
 *
 * Shapes per the contract. `lud16` is computed `${username}@${domain}` at runtime.
 * Contacts have NO `version` column (CREATE/DELETE only) → ordering/dedupe is
 * op-type + refetch.
 *
 * NOTE (master drift — flag for review): master's `app/features/contacts/contact.ts`
 * `Contact.createdAt` is a `string` (ISO) and `UserProfile = Pick<User,'id'|'username'>`
 * (no `lud16`). The contract (§8) specifies `createdAt: Date` and a `lud16` on
 * `UserProfile`. PR1 follows the CONTRACT. Reconcile during Slice 4 (lift vs spec).
 */

/**
 * A saved contact — another Agicash user the owner can pay. CREATE/DELETE only
 * (no `version` column), so ordering/dedupe is by op-type + refetch.
 */
export type Contact = {
  /** UUID of the contact row. */
  id: string;
  /** Id of the user that this contact belongs to */
  ownerId: string;
  /** Username of the user within this app that this contact references */
  username: string;
  /** Lightning Address of the user that this contact references */
  lud16: string;
  /** When the contact was created. */
  createdAt: Date;
};

/**
 * A public, addable user profile returned by {@link ContactsDomain.search}
 * (before it becomes a saved {@link Contact}).
 */
export type UserProfile = {
  /** UUID of the user. */
  id: string;
  /** The user's handle. */
  username: string;
  /** The user's Lightning Address, computed `${username}@${domain}`. */
  lud16: string;
};
