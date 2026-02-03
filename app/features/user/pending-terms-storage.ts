const key = 'pendingTermsAcceptedAt';
const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export const pendingTermsStorage = {
  get: (): string | undefined => {
    const value = sessionStorage.getItem(key);
    if (!value) return undefined;

    const timestamp = new Date(value).getTime();
    const isExpired = Date.now() - timestamp > EXPIRY_MS;

    if (isExpired) {
      sessionStorage.removeItem(key);
      return undefined;
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
