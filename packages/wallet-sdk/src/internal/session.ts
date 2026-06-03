/**
 * Internal session resolver — Slice 1 (auth + user).
 *
 * The agicash domain {@link User} lives in the `wallet.users` DB row, keyed by the
 * OpenSecret user id. Resolving "the current user" therefore takes two steps: ask the
 * enclave who is signed in (`OpenSecretClient.fetchUser`), then read that id's DB row
 * (`UserRepository.get`). Both the auth domain (whose methods return the user after a
 * sign-in) and the user domain (`getCurrentUser` / `updateUsername`) need this, so it is
 * factored here.
 *
 * This object also owns the post-auth bookkeeping shared by every sign-in path: dropping
 * the cached Supabase token (so the next DB read re-fetches under the new session) and
 * emitting `auth:signed-in`.
 *
 * @module
 */
import type { TypedEventEmitter } from './event-emitter';
import type { OpenSecretClient } from './open-secret';
import type { SupabaseSessionTokenProvider } from './supabase-session';
import type { UserRepository } from './user-repository';
import type { SdkEventMap } from '../events';
import type { User } from '../types/user';

/**
 * Resolves + tracks the current authenticated user across the OpenSecret enclave and the
 * `wallet.users` DB row. One per `Sdk` instance; shared by the auth + user domains.
 */
export class SessionResolver {
  /**
   * @param openSecret - the enclave client (who-is-signed-in + session ops).
   * @param users - the `wallet.users` repository (id → domain user).
   * @param sessionToken - the Supabase access-token cache (cleared on any session change).
   * @param events - the SDK event emitter (`auth:*`).
   */
  constructor(
    private readonly openSecret: OpenSecretClient,
    private readonly users: UserRepository,
    private readonly sessionToken: SupabaseSessionTokenProvider,
    private readonly events: TypedEventEmitter<SdkEventMap>,
  ) {}

  /**
   * The currently signed-in user, or `null` when there is no session.
   *
   * Re-houses master `useUser` / `ReadUserRepository.get`: enclave user id → DB row →
   * domain {@link User}. Returns `null` (not a throw) when signed out, matching the
   * contract's `getCurrentUser(): Promise<User | null>`.
   *
   * @returns the current user, or `null`.
   */
  async getCurrentUser(): Promise<User | null> {
    const osUser = await this.openSecret.fetchUser();
    if (!osUser) {
      return null;
    }
    return this.users.get(osUser.id);
  }

  /**
   * The current user, asserting there is one. Used by the auth methods that resolve the
   * user immediately after a successful enclave sign-in (where a session is guaranteed),
   * and by `updateUsername`.
   *
   * @returns the current user.
   * @throws Error if no session exists (should not happen on a freshly-authenticated path).
   */
  async requireCurrentUser(): Promise<User> {
    const user = await this.getCurrentUser();
    if (!user) {
      throw new Error('No authenticated user');
    }
    return user;
  }

  /**
   * Resolve the current user after a sign-in transition, then drop the cached Supabase
   * token (the next DB read re-fetches under the new identity) and emit `auth:signed-in`.
   * The shared tail of every sign-in / sign-up / guest / upgrade / OAuth-complete path.
   *
   * @returns the freshly signed-in user.
   */
  async completeSignIn(): Promise<User> {
    this.sessionToken.clear();
    const user = await this.requireCurrentUser();
    this.events.emit('auth:signed-in', { user });
    return user;
  }

  /**
   * Tear down the session locally after an enclave sign-out: drop the cached Supabase
   * token and emit `auth:signed-out`.
   */
  completeSignOut(): void {
    this.sessionToken.clear();
    this.events.emit('auth:signed-out', {});
  }
}
