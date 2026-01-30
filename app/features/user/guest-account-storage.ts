import { z } from 'zod';
import { safeJsonParse } from '~/lib/json';

const storageKey = 'guestAccount';

const GuestAccountDetailsSchema = z.object({
  id: z.string(),
  password: z.string(),
});

type GuestAccountDetails = z.infer<typeof GuestAccountDetailsSchema>;

const getGuestAccount = (): GuestAccountDetails | null => {
  const dataString = localStorage.getItem(storageKey);
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
    console.warn('Invalid guest account data found in the storage');
    return null;
  }
  return validationResult.data;
};

const storeGuestAccount = (data: GuestAccountDetails) => {
  localStorage.setItem(storageKey, JSON.stringify(data));
};

const removeGuestAccount = () => {
  localStorage.removeItem(storageKey);
};

export const guestAccountStorage = {
  get: getGuestAccount,
  store: storeGuestAccount,
  clear: removeGuestAccount,
};
