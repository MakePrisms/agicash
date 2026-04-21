const key = 'pendingTermsAcceptedAt';
const giftCardMintKey = 'pendingGiftCardMintTermsAcceptedAt';

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
  getGiftCardMintTerms: (): string | undefined => {
    return sessionStorage.getItem(giftCardMintKey) ?? undefined;
  },
  setGiftCardMintTerms: (termsAcceptedAt: string) => {
    sessionStorage.setItem(giftCardMintKey, termsAcceptedAt);
  },
  removeGiftCardMintTerms: () => {
    sessionStorage.removeItem(giftCardMintKey);
  },
};
