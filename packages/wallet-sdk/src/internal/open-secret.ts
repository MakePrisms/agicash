/**
 * OpenSecret client wiring — §1 / Slice 0 connection wiring + Slice 1 auth wrappers.
 *
 * The `@agicash/opensecret` package (the enclave/auth backend) is configured via a
 * module-global `configure({ apiUrl, clientId })` and then used through standalone
 * functions (`signIn`, `generateThirdPartyToken`, …) — there is no per-instance client
 * object. This module isolates that wiring behind a tiny `OpenSecretClient` facade so
 * the rest of the SDK does not call the global API directly, and so the auth slice has
 * one place to attach session handling.
 *
 * SESSION / STORAGE NOTE. `@agicash/opensecret` persists its own access/refresh tokens
 * (today: `localStorage`); `configure()` does NOT accept a storage adapter. So session
 * RESUME comes "for free" from the OpenSecret client rehydrating on init — there is no
 * storage-injection seam in the installed package. The SDK still HOLDS `config.storage`
 * (threaded to {@link OpenSecretClient}) for the auth slice's own state (e.g. the guest
 * refresh-token path master reads from `localStorage`) and for the day the OpenSecret
 * SDK exposes pluggable storage. See the report / build-plan: the `@agicash/opensecret-sdk`
 * pluggable-storage contract referenced in PR1 is NOT the installed package's API.
 *
 * @module
 */
import {
  changePassword as osChangePassword,
  configure,
  confirmPasswordReset as osConfirmPasswordReset,
  convertGuestToUserAccount as osConvertGuestToUserAccount,
  fetchUser as osFetchUser,
  generateThirdPartyToken,
  handleGoogleCallback as osHandleGoogleCallback,
  initiateGoogleAuth as osInitiateGoogleAuth,
  refreshAccessToken as osRefreshAccessToken,
  requestPasswordReset as osRequestPasswordReset,
  signIn as osSignIn,
  signInGuest as osSignInGuest,
  signOut as osSignOut,
  signUp as osSignUp,
  signUpGuest as osSignUpGuest,
} from '@agicash/opensecret';
import { jwtDecode } from 'jwt-decode';
import type { StorageAdapter } from '../sdk';

/**
 * The current OpenSecret user (master `AuthUser = UserResponse['user']`). This is the
 * ENCLAVE user (id / email / verified flag), NOT the agicash domain `User` (which is a
 * `wallet.users` DB row). The auth/user domains use `.id` to read the DB row.
 */
export type OpenSecretUser = {
  id: string;
  name: string | null;
  email?: string;
  email_verified: boolean;
  login_method: string;
  created_at: string;
  updated_at: string;
};

/** localStorage key the OpenSecret SDK persists its access token under. */
const ACCESS_TOKEN_KEY = 'access_token';
/** localStorage key the OpenSecret SDK persists its refresh token under. */
const REFRESH_TOKEN_KEY = 'refresh_token';

/** Init params for the OpenSecret client (from `SdkConfig.openSecret`). */
export type OpenSecretConfig = {
  /** enclave/auth backend URL (master `VITE_OPEN_SECRET_API_URL`). */
  url: string;
  /** project/tenant client id (master `VITE_OPEN_SECRET_CLIENT_ID`). */
  clientId: string;
};

/**
 * Thin facade over the module-global `@agicash/opensecret` SDK. One per `Sdk` instance.
 *
 * PR2 wired CONFIGURATION + the third-party-token fetch (the OpenSecret surface the core
 * connection layer needs — it feeds the Supabase access-token provider). Slice 1 (auth +
 * user) adds the auth wrappers (`signIn` / `signUp` / guest / OAuth / password) + session
 * presence (`hasSession`) + the current enclave user (`fetchUser`). Each auth method is a
 * thin pass-through; the SDK domain layer (see ../domains/auth) adds the DB-user
 * resolution + events.
 */
export class OpenSecretClient {
  /**
   * @param config - the `{ url, clientId }` enclave params.
   * @param storage - the pluggable storage adapter (held for the auth slice; see the
   *   module note on why it is not passed to `configure`).
   */
  constructor(
    config: OpenSecretConfig,
    readonly storage: StorageAdapter,
  ) {
    if (!config.url) {
      throw new Error('SdkConfig.openSecret.url is required');
    }
    if (!config.clientId) {
      throw new Error('SdkConfig.openSecret.clientId is required');
    }
    // Module-global; idempotent for a given process. With a single SDK instance per
    // process (the contract's topology) this is the one configuration point.
    configure({ apiUrl: config.url, clientId: config.clientId });
  }

  /**
   * Fetch an OpenSecret third-party JWT for the given `audience` (e.g. the Supabase
   * project). Thin pass-through to `generateThirdPartyToken`; the staleness/caching
   * lives in {@link SupabaseSessionTokenProvider}.
   *
   * @param audience - optional token audience.
   * @returns the JWT string.
   */
  async generateThirdPartyToken(audience?: string): Promise<string> {
    const { token } = await generateThirdPartyToken(audience);
    return token;
  }

  // --- session presence ------------------------------------------------------

  /**
   * Whether a (non-expired) OpenSecret session exists, read from the storage adapter.
   *
   * Re-houses master `shared/auth.ts#isLoggedIn` off `window.localStorage` onto the
   * injected {@link StorageAdapter}: there must be both an access and a refresh token,
   * and the refresh token must not be expired. Used to short-circuit `getCurrentUser`
   * and the Supabase token provider to `null` when signed out (rather than letting the
   * enclave request fail).
   *
   * @returns `true` when a live session is present.
   */
  async hasSession(): Promise<boolean> {
    const [accessToken, refreshToken] = await Promise.all([
      this.storage.getItem(ACCESS_TOKEN_KEY),
      this.storage.getItem(REFRESH_TOKEN_KEY),
    ]);
    if (!accessToken || !refreshToken) {
      return false;
    }
    const { exp } = jwtDecode(refreshToken);
    return !!exp && exp * 1000 > Date.now();
  }

  // --- auth (OpenSecret SDK wrappers; framework-free) ------------------------
  //
  // Each is a thin pass-through to the module-global `@agicash/opensecret` function;
  // the SDK domain layer (see ../domains/auth) adds the DB-user resolution + events.
  // The OpenSecret SDK persists/clears its own access+refresh tokens internally.

  /** Sign in an existing user (enclave). Persists the session internally. */
  async signIn(email: string, password: string): Promise<void> {
    await osSignIn(email, password);
  }

  /** Create a full (email) user and sign it in (enclave). `inviteCode` is `''` (master). */
  async signUp(email: string, password: string): Promise<void> {
    await osSignUp(email, password, '');
  }

  /** Create a guest user (enclave), returning its generated id. `inviteCode` is `''`. */
  async signUpGuest(password: string): Promise<{ id: string }> {
    const { id } = await osSignUpGuest(password, '');
    return { id };
  }

  /** Sign in to an existing guest account by its id + generated password (enclave). */
  async signInGuest(id: string, password: string): Promise<void> {
    await osSignInGuest(id, password);
  }

  /** Sign out (enclave). Clears the persisted session internally. */
  async signOut(): Promise<void> {
    await osSignOut();
  }

  /** Refresh the access token (enclave). Updates the persisted session internally. */
  async refresh(): Promise<void> {
    await osRefreshAccessToken();
  }

  /** Convert the current guest user into a full (email) account (enclave). */
  async convertGuestToUserAccount(
    email: string,
    password: string,
  ): Promise<void> {
    await osConvertGuestToUserAccount(email, password);
  }

  /** Change the signed-in user's password (enclave). */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await osChangePassword(currentPassword, newPassword);
  }

  /**
   * Request a password reset (enclave). The caller hashes a freshly-generated secret and
   * passes the hash; the secret is returned so the caller can later confirm the reset.
   */
  async requestPasswordReset(
    email: string,
    hashedSecret: string,
  ): Promise<void> {
    await osRequestPasswordReset(email, hashedSecret);
  }

  /** Confirm a password reset with the emailed code + the secret from the request (enclave). */
  async confirmPasswordReset(
    email: string,
    alphanumericCode: string,
    plaintextSecret: string,
    newPassword: string,
  ): Promise<void> {
    await osConfirmPasswordReset(
      email,
      alphanumericCode,
      plaintextSecret,
      newPassword,
    );
  }

  /** Begin Google OAuth (enclave); returns the raw `auth_url` to redirect to. `inviteCode` is `''`. */
  async initiateGoogleAuth(): Promise<{ authUrl: string }> {
    const { auth_url } = await osInitiateGoogleAuth('');
    return { authUrl: auth_url };
  }

  /** Complete Google OAuth from the redirect callback params (enclave). Persists the session. */
  async handleGoogleCallback(
    code: string,
    state: string,
    inviteCode: string,
  ): Promise<void> {
    await osHandleGoogleCallback(code, state, inviteCode);
  }

  /**
   * The current enclave user (`fetchUser`), or `null` when there is no session. Returns
   * the OpenSecret user — the domain layer maps `.id` to the `wallet.users` DB row.
   */
  async fetchUser(): Promise<OpenSecretUser | null> {
    if (!(await this.hasSession())) {
      return null;
    }
    const { user } = await osFetchUser();
    return user;
  }
}
