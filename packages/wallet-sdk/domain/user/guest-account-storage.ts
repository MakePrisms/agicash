import { safeJsonParse } from '@agicash/utils';
import { z } from 'zod/mini';
import type { AuthKeyValueStore, Logger } from '../../sdk';

// Key predates the SDK move — existing devices have guest credentials stored
// under it, so it must not change.
const storageKey = 'guestAccount';

const GuestAccountDetailsSchema = z.object({
  id: z.string(),
  password: z.string(),
});

export type GuestAccountDetails = z.infer<typeof GuestAccountDetailsSchema>;

export type GuestAccountStorage = {
  get(): Promise<GuestAccountDetails | null>;
  store(details: GuestAccountDetails): Promise<void>;
  clear(): Promise<void>;
};

export function createGuestAccountStorage(
  store: AuthKeyValueStore,
  logger?: Logger,
): GuestAccountStorage {
  return {
    async get() {
      const dataString = await store.getItem(storageKey);
      if (!dataString) {
        return null;
      }
      const parseResult = safeJsonParse(dataString);
      if (!parseResult.success) {
        return null;
      }
      const validationResult = GuestAccountDetailsSchema.safeParse(
        parseResult.data,
      );
      if (!validationResult.success) {
        logger?.warn('Invalid guest account data found in the storage');
        return null;
      }
      return validationResult.data;
    },
    async store(details) {
      await store.setItem(storageKey, JSON.stringify(details));
    },
    async clear() {
      await store.removeItem(storageKey);
    },
  };
}
