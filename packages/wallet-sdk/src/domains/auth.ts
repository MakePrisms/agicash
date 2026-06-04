/**
 * `AuthDomain` implementation — §4 of the contract, Slice 1.
 *
 * EXTRACTED (re-housed framework-free) from `apps/web-wallet/app/features/user/auth.ts`
 * (the `useAuthActions` hook + the OpenSecret-SDK wrappers) and
 * `apps/web-wallet/app/features/shared/auth.ts`. Master expresses auth as a React hook
 * over TanStack-Query invalidation + `react-router` navigation + `window.localStorage`;
 * all of that is stripped. What remains is the enclave calls + the agicash `User`
 * resolution + the SDK's `auth:*` events:
 *
 *  - sign-in/up/guest/upgrade/OAuth-complete call OpenSecret, then resolve the
 *    `wallet.users` DB row (via {@link SessionResolver.completeSignIn}) and return the
 *    domain {@link User}, emitting `auth:signed-in`;
 *  - sign-out calls OpenSecret then emits `auth:signed-out`;
 *  - refresh / changePassword / resetPassword are thin enclave pass-throughs that master
 *    expresses implicitly via the OS SDK (the contract names them explicitly).
 *
 * Every method is an ACTION → `Promise` (no observable reads here), so the reactive
 * overlay (design B) leaves this domain unchanged from the no-cache extraction.
 *
 * No `getCurrentSession` method (contract decision 4 — methods return `User`, not a
 * session; the JWT stays SDK-internal). OAuth is a browser REDIRECT (`beginGoogleSignIn`
 * returns `{ authUrl }`), web-only.
 *
 * @module
 */
import type { AuthDomain } from '../domains';
import type { User } from '../types/user';
import { computeSHA256, generateRandomPassword } from '../internal/crypto';
import type { GuestAccountStorage } from '../internal/guest-account-storage';
import type { OpenSecretClient } from '../internal/open-secret';
import type { SessionResolver } from '../internal/session';

/** Length of a generated guest-account password (master `generateRandomPassword(32)`). */
const GUEST_PASSWORD_LENGTH = 32;
/** Length of the generated password-reset secret (master `generateRandomPassword(20)`). */
const RESET_SECRET_LENGTH = 20;

/** OAuth callback params handed to {@link AuthDomainImpl.completeOAuth}. */
type OAuthCallbackParams = {
  /** OAuth authorization code from the redirect. */
  code: string;
  /** OAuth `state` param from the redirect (CSRF + session correlation). */
  state: string;
  /** Optional invite code for new-user registration (defaults to `''`, as master does). */
  inviteCode?: string;
};

/**
 * The auth domain. Construct with the enclave client, the session resolver (id → DB user
 * + `auth:*` emission), and the guest-credential store.
 */
export class AuthDomainImpl implements AuthDomain {
  /**
   * @param openSecret - the OpenSecret enclave client.
   * @param session - resolves the agicash user + emits `auth:*`.
   * @param guestStorage - persists guest credentials for same-device re-sign-in.
   */
  constructor(
    private readonly openSecret: OpenSecretClient,
    private readonly session: SessionResolver,
    private readonly guestStorage: GuestAccountStorage,
  ) {}

  /**
   * Sign in an existing user with email + password.
   *
   * @param params - `{ email, password }`.
   * @returns the signed-in {@link User}.
   */
  async signIn(params: { email: string; password: string }): Promise<User> {
    await this.openSecret.signIn(params.email, params.password);
    return this.session.completeSignIn();
  }

  /**
   * Create a new full (email) account and sign it in.
   *
   * @param params - `{ email, password }`.
   * @returns the new {@link User}.
   */
  async signUp(params: { email: string; password: string }): Promise<User> {
    await this.openSecret.signUp(params.email, params.password);
    return this.session.completeSignIn();
  }

  /**
   * Create and sign in an anonymous guest user. If this device already has a stored guest
   * account, signs back into THAT account instead of minting a new one (master parity:
   * `useAuthActions.signUpGuest`). The generated password is persisted via the storage
   * adapter.
   *
   * @returns the guest {@link User}.
   */
  async signInGuest(): Promise<User> {
    const existing = await this.guestStorage.get();
    if (existing) {
      await this.openSecret.signInGuest(existing.id, existing.password);
      return this.session.completeSignIn();
    }

    const password = generateRandomPassword(GUEST_PASSWORD_LENGTH);
    const { id } = await this.openSecret.signUpGuest(password);
    await this.guestStorage.store({ id, password });
    return this.session.completeSignIn();
  }

  /**
   * Sign out the current user and clear the session.
   *
   * The OpenSecret SDK clears its own persisted tokens; this drops the cached Supabase
   * token and emits `auth:signed-out`.
   */
  async signOut(): Promise<void> {
    await this.openSecret.signOut();
    this.session.completeSignOut();
  }

  /**
   * Refresh the current session/access token (extends the session). Master expresses this
   * implicitly via the OS SDK; the contract names it explicitly.
   */
  async refresh(): Promise<void> {
    await this.openSecret.refresh();
  }

  /**
   * Send a password-reset email to `email`.
   *
   * Re-houses master `useAuthActions.requestPasswordReset`: generate a random secret, send
   * its SHA-256 hash to OpenSecret (the emailed code + this secret later confirm the reset
   * via the enclave). The contract types this `Promise<void>`; the secret needed for the
   * confirm step is held by OpenSecret's flow, so it is not surfaced here.
   *
   * @param email - the account email to reset.
   */
  async resetPassword(email: string): Promise<void> {
    const secret = generateRandomPassword(RESET_SECRET_LENGTH);
    const hashedSecret = await computeSHA256(secret);
    await this.openSecret.requestPasswordReset(email, hashedSecret);
  }

  /**
   * Change the signed-in user's password (requires the current password).
   *
   * @param params - `{ current, new }` passwords.
   */
  async changePassword(params: {
    current: string;
    new: string;
  }): Promise<void> {
    await this.openSecret.changePassword(params.current, params.new);
  }

  /**
   * Upgrade the current guest user into a full email account, preserving funds/history.
   * Clears the stored guest credentials on success (master parity:
   * `useUpgradeGuestToFullAccount`).
   *
   * @param params - `{ email, password }` for the new full account.
   * @returns the upgraded {@link User}.
   */
  async upgradeGuest(params: {
    email: string;
    password: string;
  }): Promise<User> {
    await this.openSecret.convertGuestToUserAccount(
      params.email,
      params.password,
    );
    await this.guestStorage.clear();
    return this.session.completeSignIn();
  }

  /**
   * Begin Google OAuth — returns the URL to redirect the browser to. OAuth is a REDIRECT
   * flow, not a synchronous session; web-only (the MCP daemon cannot do Google auth).
   *
   * NOTE: master also stashes the pre-redirect `location.search`/`hash` into an OAuth
   * login-session store and folds a `sessionId` into the `state` param so the post-redirect
   * page can restore context. That stashing is browser/router-specific UI plumbing and is
   * left to the web consumer (the SDK is framework-free); the SDK returns the enclave's
   * `authUrl` directly.
   *
   * @returns `{ authUrl }` to redirect to.
   */
  async beginGoogleSignIn(): Promise<{ authUrl: string }> {
    return this.openSecret.initiateGoogleAuth();
  }

  /**
   * Complete OAuth from the redirect callback params; resolves with the user.
   *
   * @param params - `{ code, state, inviteCode? }` from the OAuth redirect.
   * @returns the signed-in {@link User}.
   */
  async completeOAuth(params: OAuthCallbackParams): Promise<User> {
    await this.openSecret.handleGoogleCallback(
      params.code,
      params.state,
      params.inviteCode ?? '',
    );
    return this.session.completeSignIn();
  }
}
