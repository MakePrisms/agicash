import type {
  GoogleAuthResponse,
  LoginResponse,
  UserResponse,
} from '@agicash/opensecret';
import {
  type LongTimeout,
  clearLongTimeout,
  safeJwtDecode,
  setLongTimeout,
} from '@agicash/utils';
import { DisposedError, InstanceAlreadyUsedError } from '../../lib/error';
import {
  type GuestAccountStorage,
  createGuestAccountStorage,
} from '../../lib/guest-account-storage';
import type { AuthApi, AuthSession, AuthStorage, Logger } from '../sdk';
import type { WalletEventEmitter } from '../sdk/events';

// Keys are owned by @agicash/opensecret's token persistence; the service reads
// them (never writes) for session detection and expiry math.
const accessTokenKey = 'access_token';
const refreshTokenKey = 'refresh_token';

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
  generateGuestPassword: () => Promise<string>;
  events: WalletEventEmitter;
  /** Per-session cache cleanup on any session end (sign-out or expiry). */
  onSessionEnded?: () => void;
  /**
   * Terminal disposal of the owning instance, invoked on sign-out so the
   * instance is never reused for a second identity (instance-per-identity).
   * Distinct from {@link AuthServiceDeps.onSessionEnded}, which only clears
   * per-session caches and leaves the instance usable.
   */
  requestDispose?: () => void;
  logger: Logger;
};

export class AuthService implements AuthApi {
  private session: AuthSession = { isLoggedIn: false };
  private restorePromise: Promise<void> | undefined;
  private expiryTimeout: LongTimeout | undefined;
  // Aborted and replaced on every session transition (a login apply or a
  // session end). An in-flight restore holds the signal it started under; once
  // that signal is aborted its result belongs to a session that no longer
  // exists and must not be applied.
  private sessionScope = new AbortController();
  private disposed = false;
  // The identity this instance is bound to, set at the first establish (see
  // applySessionFromServer). An instance serves one identity for its lifetime:
  // the auth verbs refuse a second establish, and an apply resolving to a
  // different id is refused even after the session has gone anonymous.
  private establishedIdentityId: string | undefined;
  private readonly guestAccountStorage: GuestAccountStorage;

  constructor(private readonly deps: AuthServiceDeps) {
    this.guestAccountStorage = createGuestAccountStorage(
      deps.storage.persistent,
      deps.logger,
    );
  }

  getSession(): AuthSession {
    return this.session;
  }

  /**
   * Idempotent session restore from storage; resolving anonymous is
   * a state, not a failure. A rejection (unreadable storage, failed user
   * fetch with tokens present) is not memoized, so a retry can recover.
   */
  async restoreSession(): Promise<void> {
    this.assertNotDisposed();
    if (!this.restorePromise) {
      const restorePromise: Promise<void> = this.doRestore().catch((error) => {
        // Un-memoize only our own memo: a session end may already have
        // cleared it, and a newer restore may own the slot by now.
        if (this.restorePromise === restorePromise) {
          this.restorePromise = undefined;
        }
        throw error;
      });
      this.restorePromise = restorePromise;
    }
    return this.restorePromise;
  }

  private async doRestore(): Promise<void> {
    if (this.session.isLoggedIn) {
      // A sign-in (or another auth action) already established the session and
      // a preceding session end un-memoized the restore; booting from storage
      // now would only repeat the user fetch that action already did.
      return;
    }
    const [accessToken, refreshToken] = await Promise.all([
      this.deps.storage.persistent.getItem(accessTokenKey),
      this.deps.storage.persistent.getItem(refreshTokenKey),
    ]);
    if (!accessToken || !refreshToken) {
      return;
    }
    if (!safeJwtDecode(refreshToken)?.exp) {
      // A refresh token with no readable expiry can't be scheduled for renewal
      // and can't be refreshed, so the session would run until the token
      // silently expired and then break with no way to recover. Stay anonymous
      // instead of entering a session that can't be kept alive.
      return;
    }
    const scope = this.sessionScope.signal;
    try {
      await this.applySessionFromServer({ scope });
    } catch (error) {
      if (this.session.isLoggedIn) {
        // An auth action established a session while this restore's fetch was
        // in flight; the restore result is moot.
        return;
      }
      if (scope.aborted) {
        // A sign-out or a newer session apply owns the session state now;
        // ending the session here would abort that owner's scope too.
        throw error;
      }
      // Contract: init() rejects on refresh errors (tokens exist but can't
      // be validated). endSession keeps the instance consistent; the
      // rejection is un-memoized by restoreSession, so a retry can succeed.
      this.endSession();
      throw error;
    }
  }

  async signUp(email: string, password: string): Promise<void> {
    this.assertNotDisposed();
    this.assertUnused();
    await this.deps.os.signUp(email, password, '');
    await this.refreshSessionSnapshot('sign up');
  }

  async signUpGuest(): Promise<void> {
    this.assertNotDisposed();
    this.assertUnused();
    await this.signInGuestAccount();
    await this.refreshSessionSnapshot('guest sign up');
  }

  /**
   * Signs into the stored guest account, creating and persisting a new one
   * when none is stored. Fresh tokens land in storage as a side effect; the
   * session snapshot is not touched.
   */
  private async signInGuestAccount(): Promise<void> {
    const existingGuestAccount = await this.guestAccountStorage.get();
    if (existingGuestAccount) {
      await this.deps.os.signInGuest(
        existingGuestAccount.id,
        existingGuestAccount.password,
      );
      return;
    }
    const password = await this.deps.generateGuestPassword();
    const guestAccount = await this.deps.os.signUpGuest(password, '');
    try {
      await this.guestAccountStorage.store({
        id: guestAccount.id,
        password,
      });
    } catch (error) {
      // Credentials that can't be persisted strand the account at its first
      // expiry (the extension would mint a fresh guest and the funds would be
      // unreachable). Undo the sign-up and fail loudly so the retry lands on
      // a recoverable account.
      try {
        await this.deps.os.signOut();
      } catch (undoError) {
        this.deps.logger.warn(
          'Failed to sign out a guest account with unpersisted credentials',
          undoError,
        );
      }
      throw error;
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    this.assertNotDisposed();
    this.assertUnused();
    await this.deps.os.signIn(email, password);
    await this.refreshSessionSnapshot('sign in');
  }

  async signOut(): Promise<void> {
    this.assertNotDisposed();
    try {
      await this.deps.os.signOut();
    } finally {
      // Clear per-session caches, then dispose: sign-out is terminal under
      // instance-per-identity, so the instance is never reused for a second
      // identity. The host builds a fresh instance for the next sign-in.
      this.endSession();
      this.deps.requestDispose?.();
    }
  }

  async verifyEmail(code: string): Promise<void> {
    this.assertNotDisposed();
    await this.deps.os.verifyEmail(code);
    await this.refreshSessionSnapshot('email verification');
  }

  async requestNewVerificationCode(): Promise<void> {
    this.assertNotDisposed();
    return this.deps.os.requestNewVerificationCode();
  }

  async convertGuestToFullAccount(
    email: string,
    password: string,
  ): Promise<void> {
    this.assertNotDisposed();
    await this.deps.os.convertGuestToUserAccount(email, password);
    await this.guestAccountStorage.clear();
    await this.refreshSessionSnapshot('guest conversion');
  }

  async initiateGoogleAuth(): Promise<{ authUrl: string }> {
    this.assertNotDisposed();
    const response = await this.deps.os.initiateGoogleAuth('');
    return { authUrl: response.auth_url };
  }

  async completeGoogleAuth(params: {
    code: string;
    state: string;
  }): Promise<void> {
    this.assertNotDisposed();
    await this.deps.os.handleGoogleCallback(params.code, params.state, '');
    await this.refreshSessionSnapshot('google auth');
  }

  /**
   * Marks the instance disposed, aborts the session scope, and stops the expiry
   * timer permanently. An in-flight restore is fenced: its late apply is
   * skipped, so a disposed instance never writes a session or runs
   * onSessionEnded — which clears process-wide caches a successor instance may
   * already own. Auth actions called after this throw DisposedError. Stored
   * tokens and the last session snapshot are left intact — disposal is not
   * sign-out, so a successor instance (e.g. after a hot reload) can restore.
   */
  teardown(): void {
    this.disposed = true;
    this.sessionScope.abort();
    this.clearExpiryTimer();
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new DisposedError();
    }
  }

  private assertUnused(): void {
    if (this.establishedIdentityId !== undefined) {
      throw new InstanceAlreadyUsedError();
    }
  }

  private async refreshSessionSnapshot(
    context: string,
    scope?: AbortSignal,
  ): Promise<boolean> {
    try {
      return await this.applySessionFromServer(scope ? { scope } : undefined);
    } catch (error) {
      // An auth action whose fetchUser fails leaves an anonymous session the
      // host discovers on its next read. endSession (not a bare snapshot clear)
      // runs so the per-session caches die with the session — the Supabase
      // token cache in particular must never outlive it. The session was
      // resolved (to anonymous) here, so this counts as applied, not skipped.
      this.deps.logger.error(`Failed to fetch user (${context})`, error);
      this.endSession();
      return true;
    }
  }

  /**
   * Fetches the user and applies the session, returning whether it applied.
   * Returns false without writing when the instance was disposed or `scope` was
   * aborted while the fetch was in flight (a newer transition owns the state).
   */
  private async applySessionFromServer(options?: {
    /** Skip the apply if this scope was aborted while the fetch was in flight. */
    scope?: AbortSignal;
  }): Promise<boolean> {
    const response = await this.deps.os.fetchUser();
    if (this.disposed || options?.scope?.aborted) {
      // The instance was disposed, or a sign-out / newer apply won, while this
      // fetch was in flight; the stale result must not write a session or run
      // onSessionEnded.
      return false;
    }
    if (
      this.establishedIdentityId !== undefined &&
      this.establishedIdentityId !== response.user.id
    ) {
      // Instance-per-identity: this instance is bound to one identity for its
      // lifetime. A different identity surfacing here — a login without a prior
      // sign-out (already refused by assertUnused), or foreign tokens written by
      // an unguarded verb / an OAuth callback that a restore or refresh then
      // resolves — is refused, not adopted, even once the session has gone
      // anonymous. Revoke the foreign tokens first so the host's rebuild can't
      // restore that identity from storage, then end the session and tell the
      // host to build a fresh instance.
      try {
        await this.deps.os.signOut();
      } catch (error) {
        this.deps.logger.warn(
          'Sign out revoking a cross-identity apply failed',
          error,
        );
      }
      this.endSession();
      this.deps.events.emit('auth.session-expired', {});
      return false;
    }
    this.startNewSessionScope();
    this.session = { isLoggedIn: true, user: response.user };
    this.establishedIdentityId = response.user.id;
    await this.setExpiryTimer();
    return true;
  }

  private endSession(): void {
    this.startNewSessionScope();
    this.session = { isLoggedIn: false };
    this.clearExpiryTimer();
    // Un-memoize the restore so the next init() re-evaluates from storage: an
    // auth action whose post-login fetchUser failed leaves tokens behind, and
    // the next invalidation can then recover the session.
    this.restorePromise = undefined;
    this.deps.onSessionEnded?.();
  }

  // Aborts the current session scope, fencing any in-flight restore or apply
  // out, and installs a fresh scope for the session that is starting or ending.
  private startNewSessionScope(): void {
    this.sessionScope.abort();
    this.sessionScope = new AbortController();
  }

  private async setExpiryTimer(): Promise<void> {
    const remaining = await this.getRemainingSessionTimeMs();
    // Clear only after the await, so clear + check + assign run as one
    // synchronous block: two overlapping calls can't interleave and orphan a
    // timer, and a teardown during the await can't be overridden.
    this.clearExpiryTimer();
    if (this.disposed || remaining === null) {
      return;
    }
    this.expiryTimeout = setLongTimeout(() => {
      this.handleSessionExpiry();
    }, remaining);
  }

  /**
   * Milliseconds until the stored refresh token is treated as expired, floored
   * at 0. The 5s margin treats the token as expired early so a refresh runs
   * before the real expiry. Null when the token is absent or undecodable.
   */
  private async getRemainingSessionTimeMs(): Promise<number | null> {
    const refreshToken =
      await this.deps.storage.persistent.getItem(refreshTokenKey);
    if (!refreshToken) {
      return null;
    }
    const decoded = safeJwtDecode(refreshToken);
    if (!decoded?.exp) {
      return null;
    }
    return Math.max((decoded.exp - 5) * 1000 - Date.now(), 0);
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimeout) {
      clearLongTimeout(this.expiryTimeout);
      this.expiryTimeout = undefined;
    }
  }

  // Best-effort against concurrent session transitions, not race-free
  // (PR #1166 review, finding 1). A sign-out that wins while the guest
  // re-sign-in below is in flight is fenced two ways: the scope check right
  // after the re-sign-in compensates by clearing the fresh tokens, and the
  // extension's apply is scope-guarded so a sign-out during it can't resurrect
  // the session the sign-out ended. teardown() is likewise checked before the
  // re-sign-in's tokens or the death path are acted on. Residual windows: the
  // token write inside os.signInGuest can still interleave with a sign-out's
  // storage clear, and the cross-instance (HMR successor) case keeps a narrow
  // gap — both require the timer to fire inside a sign-out's network round trip,
  // on guest sessions only.
  private async handleSessionExpiry(): Promise<void> {
    const session = this.session;
    const scope = this.sessionScope.signal;
    if (this.disposed || !session.isLoggedIn) {
      return;
    }
    // Open Secret rotates the refresh token during its own internal refresh, so
    // the expiry this timer was set for may have moved later. Re-read the
    // stored token and, if it now expires further out, set the timer again
    // instead of ending a session that is still alive.
    const remaining = await this.getRemainingSessionTimeMs();
    if (remaining !== null && remaining > 0) {
      await this.setExpiryTimer();
      return;
    }
    const isGuest = !session.user.email;
    if (isGuest) {
      try {
        // Re-signing-in the stored guest account gets fresh tokens; the
        // snapshot below re-sets the timer so the host never observes expiry.
        await this.signInGuestAccount();
        if (this.disposed || scope.aborted) {
          // A transition won the race while the re-sign-in was in flight. If a
          // sign-out ended the session, the re-sign-in's fresh tokens would
          // resurrect it on the next restore, so clear them again and revoke
          // server-side (opensecret owns the keys, so its signOut is the whole
          // cleanup). After teardown the tokens are left for the successor
          // instance; a live session means another login won and owns them.
          if (!this.disposed && !this.session.isLoggedIn) {
            try {
              await this.deps.os.signOut();
            } catch (error) {
              this.deps.logger.warn(
                'Sign out compensating a raced guest extension failed',
                error,
              );
            }
          }
          return;
        }
        const applied = await this.refreshSessionSnapshot(
          'guest session extension',
          scope,
        );
        if (!applied) {
          // A sign-out (or newer login) won while the extension's apply was in
          // flight, so the apply skipped and that transition already owns the
          // session state. Don't run the death path over it.
          return;
        }
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
        this.deps.logger.warn(
          'Guest session extension did not produce a live session; ending it',
        );
      } catch (error) {
        this.deps.logger.error('Failed to extend guest session', error);
      }
    }
    if (this.disposed) {
      // teardown() won the race: a successor instance may already own the
      // stored session, so this dead instance must not sign out or emit.
      return;
    }
    try {
      await this.deps.os.signOut();
    } catch (error) {
      this.deps.logger.warn('Sign out during session expiry failed', error);
    }
    this.endSession();
    this.deps.events.emit('auth.session-expired', {});
  }
}
