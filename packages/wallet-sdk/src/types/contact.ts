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

export type Contact = {
  id: string;
  ownerId: string;
  username: string;
  /** Lightning Address of the referenced user. */
  lud16: string;
  createdAt: Date;
};

export type UserProfile = {
  id: string;
  username: string;
  lud16: string;
};
