import type { UserResponse } from '@agicash/opensecret';

/**
 * Minimal key/value store — the Web Storage API subset the SDK persists auth
 * state through. Methods may be sync (window.localStorage) or async (React
 * Native AsyncStorage, SQLite); the SDK always awaits results. Matches the
 * @agicash/opensecret StorageProvider interface verbatim, so one host object
 * backs both.
 */
export type AuthKeyValueStore = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};

/**
 * Host-backed session persistence. `persistent` must survive restarts (auth
 * tokens, guest credentials); `session` is per-app-session (attestation
 * handshake material). Browser hosts map them to localStorage/sessionStorage.
 */
export type AuthStorage = {
  persistent: AuthKeyValueStore;
  session: AuthKeyValueStore;
};

export type AuthUser = UserResponse['user'];

export type AuthSession =
  | { isLoggedIn: true; user: AuthUser }
  | { isLoggedIn: false };

export type AuthApi = {
  /** Creates a full account and signs the user in. */
  signUp(email: string, password: string): Promise<void>;
  /** Re-signs-in this device's prior guest account if one exists. */
  signUpGuest(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  /**
   * Stops the task processor, tears down realtime, clears the stored session; the
   * instance stays usable in anonymous state.
   */
  signOut(): Promise<void>;
  verifyEmail(code: string): Promise<void>;
  requestNewVerificationCode(): Promise<void>;
  convertGuestToFullAccount(email: string, password: string): Promise<void>;
  /** Returns the URL to redirect to. */
  initiateGoogleAuth(): Promise<{ authUrl: string }>;
  /** OAuth callback leg. */
  completeGoogleAuth(params: { code: string; state: string }): Promise<void>;
  /** Sync snapshot; no I/O. */
  getSession(): AuthSession;
};
