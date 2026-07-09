import type {
  GoogleAuthResponse,
  LoginResponse,
  UserResponse,
} from '@agicash/opensecret';
import {
  type LongTimeout,
  clearLongTimeout,
  setLongTimeout,
} from '@agicash/utils';
import { jwtDecode } from 'jwt-decode';
import type { WalletEventEmitter } from '../../lib/events';
import type { AuthApi, AuthSession, AuthStorage, Logger } from '../../sdk';
import type { GuestAccountStorage } from './guest-account-storage';

// Keys are owned by @agicash/opensecret's token persistence; the service reads
// them (never writes) for session detection and expiry math.
const accessTokenKey = 'access_token';
const refreshTokenKey = 'refresh_token';

// A corrupt stored token must degrade (no timer / expiry path), never throw
// from a timer callback or a query fn.
const decodeJwt = (token: string): { exp?: number } | null => {
  try {
    return jwtDecode(token);
  } catch {
    return null;
  }
};

/** The subset of @agicash/opensecret the auth service drives. `import * as openSecret` satisfies it. */
export type OpenSecretAuthApi = {
  fetchUser(): Promise<UserResponse>;
  signIn(email: string, password: string): Promise<LoginResponse>;
  signUp(
    email: string,
    password: string,
    inviteCode: string,
    name?: string | null,
  ): Promise<LoginResponse>;
  signUpGuest(password: string, inviteCode: string): Promise<LoginResponse>;
  signInGuest(id: string, password: string): Promise<LoginResponse>;
  signOut(): Promise<void>;
  verifyEmail(code: string): Promise<void>;
  requestNewVerificationCode(): Promise<void>;
  convertGuestToUserAccount(
    email: string,
    password: string,
    name?: string | null,
  ): Promise<void>;
  initiateGoogleAuth(inviteCode?: string): Promise<GoogleAuthResponse>;
  handleGoogleCallback(
    code: string,
    state: string,
    inviteCode: string,
  ): Promise<LoginResponse>;
};

type AuthServiceDeps = {
  os: OpenSecretAuthApi;
  storage: AuthStorage;
  guestAccountStorage: GuestAccountStorage;
  generateGuestPassword: () => Promise<string>;
  events: WalletEventEmitter;
  /** Per-session cache cleanup on any session end (sign-out or expiry). */
  onSessionEnded?: () => void;
  logger?: Logger;
};

export class AuthService implements AuthApi {
  private session: AuthSession = { isLoggedIn: false };
  private restorePromise: Promise<void> | undefined;
  private expiryTimeout: LongTimeout | undefined;
  // Survives endSession() deliberately — see applySessionFromServer.
  private lastUserId: string | undefined;

  constructor(private readonly deps: AuthServiceDeps) {}

  getSession(): AuthSession {
    return this.session;
  }

  /**
   * Idempotent session restore from the storage port; resolving anonymous is
   * a state, not a failure. A rejection (unreadable storage, failed user
   * fetch with tokens present) is not memoized, so a retry can recover.
   */
  restoreSession(): Promise<void> {
    this.restorePromise ??= this.doRestore().catch((error) => {
      this.restorePromise = undefined;
      throw error;
    });
    return this.restorePromise;
  }

  private async doRestore(): Promise<void> {
    const [accessToken, refreshToken] = await Promise.all([
      this.deps.storage.persistent.getItem(accessTokenKey),
      this.deps.storage.persistent.getItem(refreshTokenKey),
    ]);
    if (!accessToken || !refreshToken) {
      return;
    }
    try {
      await this.applySessionFromServer();
    } catch (error) {
      if (this.session.isLoggedIn) {
        // An auth verb established a session while this restore was in
        // flight; the restore result is moot.
        return;
      }
      // Contract: init() rejects on refresh errors (tokens exist but can't
      // be validated). endSession keeps the instance consistent; the
      // rejection is un-memoized by restoreSession, so a retry can succeed.
      this.endSession();
      throw error;
    }
  }

  async signUp(email: string, password: string): Promise<void> {
    await this.deps.os.signUp(email, password, '');
    await this.refreshSessionSnapshot('sign up');
  }

  async signUpGuest(): Promise<void> {
    const existingGuestAccount = await this.deps.guestAccountStorage.get();
    if (existingGuestAccount) {
      await this.deps.os.signInGuest(
        existingGuestAccount.id,
        existingGuestAccount.password,
      );
    } else {
      const password = await this.deps.generateGuestPassword();
      const guestAccount = await this.deps.os.signUpGuest(password, '');
      await this.deps.guestAccountStorage.store({
        id: guestAccount.id,
        password,
      });
    }
    await this.refreshSessionSnapshot('guest sign up');
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.deps.os.signIn(email, password);
    await this.refreshSessionSnapshot('sign in');
  }

  async signOut(): Promise<void> {
    try {
      await this.deps.os.signOut();
    } finally {
      this.endSession();
    }
  }

  async verifyEmail(code: string): Promise<void> {
    await this.deps.os.verifyEmail(code);
    await this.refreshSessionSnapshot('email verification');
  }

  requestNewVerificationCode(): Promise<void> {
    return this.deps.os.requestNewVerificationCode();
  }

  async convertGuestToFullAccount(
    email: string,
    password: string,
  ): Promise<void> {
    await this.deps.os.convertGuestToUserAccount(email, password);
    await this.deps.guestAccountStorage.clear();
    await this.refreshSessionSnapshot('guest conversion');
  }

  async initiateGoogleAuth(): Promise<{ authUrl: string }> {
    const response = await this.deps.os.initiateGoogleAuth('');
    return { authUrl: response.auth_url };
  }

  async completeGoogleAuth(params: {
    code: string;
    state: string;
  }): Promise<void> {
    await this.deps.os.handleGoogleCallback(params.code, params.state, '');
    await this.refreshSessionSnapshot('google auth');
  }

  /** Cancels the expiry timer; the instance stays usable. */
  teardown(): void {
    this.disarmExpiryTimer();
  }

  private async refreshSessionSnapshot(context: string): Promise<void> {
    try {
      await this.applySessionFromServer();
    } catch (error) {
      // Swallowed for parity: a verb whose fetchUser fails leaves an
      // anonymous session the host discovers on its next read, like the old
      // web glue. endSession (not a bare snapshot clear) so the per-session
      // caches die with the session — the Supabase token cache in particular
      // must never outlive it.
      this.deps.logger?.error(`Failed to fetch user (${context})`, error);
      this.endSession();
    }
  }

  private async applySessionFromServer(): Promise<void> {
    const response = await this.deps.os.fetchUser();
    // Compared against the last seen user rather than the live session: a
    // memo repopulated by a request that resolved after sign-out must still
    // be wiped when a DIFFERENT user's session begins, and by then the
    // session is anonymous. Same-user re-login keeps its memos warm.
    if (this.lastUserId && this.lastUserId !== response.user.id) {
      this.deps.onSessionEnded?.();
    }
    this.lastUserId = response.user.id;
    this.session = { isLoggedIn: true, user: response.user };
    await this.armExpiryTimer();
  }

  private endSession(): void {
    this.session = { isLoggedIn: false };
    this.disarmExpiryTimer();
    // Un-memoize the restore so the next init() re-evaluates from storage —
    // a verb whose post-login fetchUser failed leaves tokens behind, and the
    // next invalidation can then recover the session like the old glue did.
    this.restorePromise = undefined;
    this.deps.onSessionEnded?.();
  }

  private async armExpiryTimer(): Promise<void> {
    const remaining = await this.getRemainingSessionTimeMs();
    // Disarm only after the await, so disarm+assign form one synchronous
    // block — two overlapping arms can't interleave and orphan a timer.
    this.disarmExpiryTimer();
    if (remaining === null) {
      return;
    }
    // Floor of 1ms: setLongTimeout fires synchronously at delay 0, which
    // would recurse into handleSessionExpiry from inside a login verb.
    this.expiryTimeout = setLongTimeout(
      () => {
        void this.handleSessionExpiry();
      },
      Math.max(remaining, 1),
    );
  }

  /**
   * Milliseconds until the stored refresh token is treated as expired (5s
   * before actual expiry, matching the previous web behavior), floored at 0.
   * Null when the token is absent or undecodable.
   */
  private async getRemainingSessionTimeMs(): Promise<number | null> {
    const refreshToken =
      await this.deps.storage.persistent.getItem(refreshTokenKey);
    if (!refreshToken) {
      return null;
    }
    const decoded = decodeJwt(refreshToken);
    if (!decoded?.exp) {
      return null;
    }
    return Math.max((decoded.exp - 5) * 1000 - Date.now(), 0);
  }

  private disarmExpiryTimer(): void {
    if (this.expiryTimeout) {
      clearLongTimeout(this.expiryTimeout);
      this.expiryTimeout = undefined;
    }
  }

  private async handleSessionExpiry(): Promise<void> {
    const session = this.session;
    if (!session.isLoggedIn) {
      return;
    }
    // The Open Secret SDK rotates the refresh token during its internal
    // refresh flow, so the expiry this timer was armed for may have moved.
    // Re-check the stored token and re-arm instead of expiring a live session.
    const remaining = await this.getRemainingSessionTimeMs();
    if (remaining !== null && remaining > 0) {
      await this.armExpiryTimer();
      return;
    }
    const isGuest = !session.user.email;
    if (isGuest) {
      try {
        // Re-signing-in the stored guest account gets fresh tokens and re-arms
        // the timer; the host never observes the expiry.
        await this.signUpGuest();
        const extendedRemaining = await this.getRemainingSessionTimeMs();
        if (
          extendedRemaining !== null &&
          extendedRemaining > 0 &&
          this.session.isLoggedIn
        ) {
          // The host didn't initiate this refresh, so it must be told —
          // the web re-syncs its auth query + session-hint cookie from it.
          this.deps.events.emit('auth.session-refreshed', {});
          return;
        }
        // Falls through when the extension produced no live session (already-
        // expired token — also guards a hot extend loop — or a failed
        // post-extend user fetch), so the death path emits the event instead
        // of leaving a wedged half-session.
        this.deps.logger?.warn(
          'Guest session extension did not produce a live session; ending it',
        );
      } catch (error) {
        this.deps.logger?.error('Failed to extend guest session', error);
      }
    }
    try {
      await this.deps.os.signOut();
    } catch (error) {
      this.deps.logger?.warn('Sign out during session expiry failed', error);
    }
    this.endSession();
    this.deps.events.emit('auth.session-expired', {});
  }
}
