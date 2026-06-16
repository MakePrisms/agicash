import type { StorageProvider } from '@agicash/opensecret';

const GUEST_KEY = 'guestAccount';

/** A persisted guest's OpenSecret id + generated password. */
export type GuestCredentials = { id: string; password: string };

/**
 * Stores guest credentials in the SDK's persistent storage (framework-free;
 * browser = localStorage, MCP = its own provider). Mirrors the web's
 * `guestAccountStorage` shape under the same `guestAccount` key.
 */
export class GuestCredentialStore {
  constructor(private readonly storage: StorageProvider) {}

  async get(): Promise<GuestCredentials | null> {
    const raw = await this.storage.persistent.getItem(GUEST_KEY);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<GuestCredentials>;
      if (typeof parsed.id === 'string' && typeof parsed.password === 'string') {
        return { id: parsed.id, password: parsed.password };
      }
    } catch {
      // fall through to null on malformed JSON
    }
    return null;
  }

  async store(credentials: GuestCredentials): Promise<void> {
    await this.storage.persistent.setItem(GUEST_KEY, JSON.stringify(credentials));
  }

  async clear(): Promise<void> {
    await this.storage.persistent.removeItem(GUEST_KEY);
  }
}
