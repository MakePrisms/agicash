const createTermsStorage = (key: string) => ({
  get: (): string | undefined => sessionStorage.getItem(key) ?? undefined,
  set: (termsAcceptedAt: string) => {
    sessionStorage.setItem(key, termsAcceptedAt);
  },
  remove: () => {
    sessionStorage.removeItem(key);
  },
});

export const pendingWalletTermsStorage = createTermsStorage(
  'pendingTermsAcceptedAt',
);
export const pendingGiftCardMintTermsStorage = createTermsStorage(
  'pendingGiftCardMintTermsAcceptedAt',
);
