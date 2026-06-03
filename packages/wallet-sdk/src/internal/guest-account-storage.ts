/**
 * Guest-account credential storage — Slice 1 (auth + user).
 *
 * EXTRACTED (re-housed framework-free) from
 * `app/features/user/guest-account-storage.ts`. A guest account has no email, so its
 * generated id + password must be persisted to let the SAME device sign back into the
 * SAME guest account (rather than minting a new one each time). Master persists this in
 * `window.localStorage`; the SDK persists it through the injected {@link StorageAdapter}
 * (so MCP/fs works too).
 *
 * @module
 */
import type { StorageAdapter } from '../types/dependencies';

/** Storage key the guest credentials are persisted under (matches master). */
const STORAGE_KEY = 'guestAccount';

/** The persisted guest credentials. */
export type GuestAccount = {
  /** The guest user's id (from OpenSecret `signUpGuest`). */
  id: string;
  /** The randomly-generated guest password. */
  password: string;
};

/**
 * Validate a parsed value as {@link GuestAccount} (both fields present + strings). Replaces
 * master's `zod/mini` schema check without adding a zod dependency to the SDK for this one
 * shape.
 */
function isGuestAccount(value: unknown): value is GuestAccount {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as GuestAccount).id === 'string' &&
    typeof (value as GuestAccount).password === 'string'
  );
}

/**
 * A small store for the guest-account credentials, over the injected storage adapter.
 *
 * Re-houses master's `guestAccountStorage` singleton as an instance bound to the SDK's
 * {@link StorageAdapter}. `get` tolerates absent / malformed data by returning `null`.
 */
export class GuestAccountStorage {
  /**
   * @param storage - the pluggable storage adapter.
   */
  constructor(private readonly storage: StorageAdapter) {}

  /**
   * The persisted guest credentials, or `null` if none / malformed.
   *
   * @returns the stored {@link GuestAccount} or `null`.
   */
  async get(): Promise<GuestAccount | null> {
    const raw = await this.storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return isGuestAccount(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Persist the guest credentials.
   *
   * @param account - the `{ id, password }` to store.
   */
  async store(account: GuestAccount): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(account));
  }

  /** Remove the persisted guest credentials (e.g. after upgrading to a full account). */
  async clear(): Promise<void> {
    await this.storage.removeItem(STORAGE_KEY);
  }
}
