const key = 'pendingTermsAcceptedAt';

export const pendingTermsStorage = {
  get: (): string | undefined => {
    return sessionStorage.getItem(key) ?? undefined;
  },
  set: (termsAcceptedAt: string) => {
    sessionStorage.setItem(key, termsAcceptedAt);
  },
  remove: () => {
    sessionStorage.removeItem(key);
  },
};
