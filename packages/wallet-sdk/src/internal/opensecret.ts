import {
  changePassword as osChangePassword,
  configure as osConfigure,
  confirmPasswordReset as osConfirmPasswordReset,
  convertGuestToUserAccount as osConvertGuestToUserAccount,
  fetchUser as osFetchUser,
  generateThirdPartyToken as osGenerateThirdPartyToken,
  getPrivateKey as osGetPrivateKey,
  getPrivateKeyBytes as osGetPrivateKeyBytes,
  getPublicKey as osGetPublicKey,
  handleGoogleCallback as osHandleGoogleCallback,
  initiateGoogleAuth as osInitiateGoogleAuth,
  requestNewVerificationCode as osRequestNewVerificationCode,
  requestPasswordReset as osRequestPasswordReset,
  signIn as osSignIn,
  signInGuest as osSignInGuest,
  signOut as osSignOut,
  signUp as osSignUp,
  signUpGuest as osSignUpGuest,
  verifyEmail as osVerifyEmail,
} from '@agicash/opensecret';

/** The Open Secret `UserResponse['user']` shape (id, name, email?, email_verified, ...). */
export type AuthUser = Awaited<ReturnType<typeof osFetchUser>>['user'];

/** Injectable seam over @agicash/opensecret's standalone functions. Production
 * uses `realOpenSecret`; tests inject a fake with the same shape. Using `typeof`
 * keeps every signature in lockstep with the installed package. */
export type OpenSecret = {
  configure: typeof osConfigure;
  fetchUser: typeof osFetchUser;
  signIn: typeof osSignIn;
  signUp: typeof osSignUp;
  signInGuest: typeof osSignInGuest;
  signUpGuest: typeof osSignUpGuest;
  signOut: typeof osSignOut;
  convertGuestToUserAccount: typeof osConvertGuestToUserAccount;
  changePassword: typeof osChangePassword;
  requestNewVerificationCode: typeof osRequestNewVerificationCode;
  verifyEmail: typeof osVerifyEmail;
  requestPasswordReset: typeof osRequestPasswordReset;
  confirmPasswordReset: typeof osConfirmPasswordReset;
  initiateGoogleAuth: typeof osInitiateGoogleAuth;
  handleGoogleCallback: typeof osHandleGoogleCallback;
  generateThirdPartyToken: typeof osGenerateThirdPartyToken;
  getPrivateKey: typeof osGetPrivateKey;
  getPrivateKeyBytes: typeof osGetPrivateKeyBytes;
  getPublicKey: typeof osGetPublicKey;
};

export const realOpenSecret: OpenSecret = {
  configure: osConfigure,
  fetchUser: osFetchUser,
  signIn: osSignIn,
  signUp: osSignUp,
  signInGuest: osSignInGuest,
  signUpGuest: osSignUpGuest,
  signOut: osSignOut,
  convertGuestToUserAccount: osConvertGuestToUserAccount,
  changePassword: osChangePassword,
  requestNewVerificationCode: osRequestNewVerificationCode,
  verifyEmail: osVerifyEmail,
  requestPasswordReset: osRequestPasswordReset,
  confirmPasswordReset: osConfirmPasswordReset,
  initiateGoogleAuth: osInitiateGoogleAuth,
  handleGoogleCallback: osHandleGoogleCallback,
  generateThirdPartyToken: osGenerateThirdPartyToken,
  getPrivateKey: osGetPrivateKey,
  getPrivateKeyBytes: osGetPrivateKeyBytes,
  getPublicKey: osGetPublicKey,
};
