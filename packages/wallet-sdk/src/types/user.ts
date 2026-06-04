// User domain types — master verbatim (app/features/user/user.ts)

type CommonUserData = {
  id: string;
  username: string;
  emailVerified: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  defaultBtcAccountId: string;
  defaultUsdAccountId: string | null;
  defaultCurrency: import('./money').Currency;
  cashuLockingXpub: string;
  encryptionPublicKey: string;
  sparkIdentityPublicKey: string;
  termsAcceptedAt: string | null;
  giftCardMintTermsAcceptedAt: string | null;
};

// Exported (Slice 1) so the internal DB→domain mapper (`internal/db-user.ts`) can
// `satisfies FullUser` / `satisfies GuestUser` when narrowing a row to the domain user.
export type FullUser = CommonUserData & { email: string; isGuest: false };
export type GuestUser = CommonUserData & { isGuest: true };

export type User = FullUser | GuestUser;

/** Raw search hit — master app/features/user/user.ts:30. NO lud16 (unlike Contact). */
export type UserProfile = Pick<User, 'id' | 'username'>;
