/**
 * `UserDomain` implementation — §4 of the contract, Slice 1 (reactive overlay, design B).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/user/user-hooks.tsx` (`useUser` / `useUpdateUsername` /
 * `useUpdateUser`) + `app/features/user/user-repository.ts` (the read + the username
 * update). Master expresses these as React hooks over TanStack-Query (a `useSuspenseQuery`
 * read + a `useMutation` that writes the `UserCache`).
 *
 * REACTIVE OVERLAY: TanStack is no longer in the consumer — it is hidden inside the SDK.
 *  - `getCurrentUser()` is an OBSERVABLE FETCH → returns `Query<User | null>`. The fetch
 *    BODY is identical to the no-cache read (`SessionResolver.getCurrentUser`: enclave id
 *    → `wallet.users` row → domain {@link User}); it is simply wrapped via {@link toQuery}
 *    over the SDK-internal `QueryClient` and MEMOISED per key (`#q`) so repeated calls
 *    return the SAME stable `Query` ref (matching the per-key-memo pattern the other
 *    reactive domains use). Realtime / orchestrators (Slice 5) write the same client (e.g.
 *    `setQueryData(['currentUser'], next)`) to push fresh values to subscribers.
 *  - `updateUsername(...)` is an ACTION → stays `Promise` (lifted verbatim).
 *
 * @module
 */
import type { UserDomain } from '../domains';
import type { SessionResolver } from '../internal/session';
import type { UserRepository } from '../internal/user-repository';
import { type QueryClient, toQuery } from '../query';
import type { Query } from '../types/query';
import type { User } from '../types/user';

/** Stable query key for the current-user read (one per SDK instance). */
const CURRENT_USER_KEY = ['currentUser'] as const;

/**
 * The user domain. Construct with the SDK-internal `QueryClient` (backs the observable
 * `getCurrentUser` read), the session resolver (current-user resolution), and the
 * `wallet.users` repository (username update).
 */
export class UserDomainImpl implements UserDomain {
  /**
   * Per-key memo of the `Query` handles this domain exposes, so repeated calls to
   * `getCurrentUser()` return the SAME stable reference (consumers can use it as a
   * `useSyncExternalStore`/effect dependency). Hidden inside the SDK.
   */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Query<T> memo, keyed by string
  readonly #q = new Map<string, Query<any>>();

  /**
   * @param client - the SDK-internal TanStack `QueryClient` (never exposed to consumers).
   * @param session - resolves the current agicash {@link User} (enclave id → DB row).
   * @param users - the `wallet.users` repository (username update).
   */
  constructor(
    private readonly client: QueryClient,
    private readonly session: SessionResolver,
    private readonly users: UserRepository,
  ) {}

  /**
   * The currently signed-in user, or `null` if none — as an observable {@link Query}.
   *
   * Re-houses master `useUser`: the enclave user id → the `wallet.users` DB row → the
   * domain {@link User}, resolving to `null` when signed out. The fetch body is exactly the
   * no-cache read ({@link SessionResolver.getCurrentUser}); the reactive overlay wraps it in
   * a {@link toQuery}-backed `Query` (memoised per key). `subscribe` fires with the
   * user/`null`; `toPromise()` resolves to it; `getSnapshot()` exposes the curated state.
   *
   * @returns a stable `Query<User | null>`.
   */
  getCurrentUser(): Query<User | null> {
    const key = JSON.stringify(CURRENT_USER_KEY);
    let q = this.#q.get(key);
    if (!q) {
      q = toQuery<User | null>(this.client, CURRENT_USER_KEY, () =>
        this.session.getCurrentUser(),
      );
      this.#q.set(key, q);
    }
    return q;
  }

  /**
   * Change the signed-in user's username.
   *
   * Re-houses master `useUpdateUsername` → `WriteUserRepository.update({ username })`.
   * Resolves the current user id from the session, updates the row, and returns the fresh
   * {@link User}. Throws {@link DomainError} if the username is already taken (the
   * repository maps the Postgres unique-violation to it). An ACTION → `Promise`.
   *
   * @param username - the new username.
   * @returns the updated {@link User}.
   * @throws DomainError if the username is taken.
   * @throws Error if there is no authenticated user.
   */
  async updateUsername(username: string): Promise<User> {
    const current = await this.session.requireCurrentUser();
    // The realtime forwarder (Slice 5) also surfaces the row change as an event + writes
    // the `['currentUser']` query; this returns the fresh user directly so the caller has
    // it without awaiting that.
    return this.users.updateUsername(current.id, username);
  }
}
