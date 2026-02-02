const key = 'pendingTermsAcceptedAt';
const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export const pendingTermsStorage = {
  get: (): string | null => {
    const value = sessionStorage.getItem(key);
    if (!value) return null;

    const timestamp = new Date(value).getTime();
    const isExpired = Date.now() - timestamp > EXPIRY_MS;

    if (isExpired) {
      sessionStorage.removeItem(key);
      return null;
    }

    return value;
  },
  set: (termsAcceptedAt: string) => {
    sessionStorage.setItem(key, termsAcceptedAt);
  },
  remove: () => {
    sessionStorage.removeItem(key);
  },
};
