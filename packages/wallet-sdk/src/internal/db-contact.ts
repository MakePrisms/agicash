/**
 * Internal `wallet.contacts` DB row type — Slice 4 (contacts).
 *
 * Lifted from master `agicash-db/database.ts#AgicashDbContact`
 * (`Database['wallet']['Tables']['contacts']['Row']`, generated in `supabase/database.types.ts`).
 * Hand-written here (as in `db-account.ts` / `db-transaction.ts`) so the SDK can type the
 * otherwise-untyped Supabase reads without pulling the full generated `Database` types. NOTE:
 * `username` is nullable on the row (master's `toContact` coalesces it to `''`); there is NO
 * `version` column (contacts are CREATE/DELETE only).
 *
 * @module
 */

/** A row of the `wallet.contacts` table. */
export type AgicashDbContact = {
  /** UUID primary key. */
  id: string;
  /** Row creation time, ISO 8601. */
  created_at: string;
  /** Owning user id. */
  owner_id: string;
  /** Referenced user's username (nullable on the row). */
  username: string | null;
};
