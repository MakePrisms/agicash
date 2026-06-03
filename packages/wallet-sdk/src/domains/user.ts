/**
 * `UserDomain` implementation — §4 of the contract, Slice 1.
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/user/user-hooks.tsx` (`useUser` / `useUpdateUsername` /
 * `useUpdateUser`) + `app/features/user/user-repository.ts` (the read + the username
 * update). Master expresses these as React hooks over TanStack-Query (a `useSuspenseQuery`
 * read + a `useMutation` that writes the `UserCache`); the SDK exposes them as plain async
 * methods over the `wallet.users` repository, with no cache (events drive the consumer's
 * read-model).
 *
 * @module
 */
import type { SessionResolver } from '../internal/session';
import type { UserRepository } from '../internal/user-repository';
import type { UserDomain } from '../domains';
import type { User } from '../types/user';

/**
 * The user domain. Construct with the session resolver (current-user resolution) and the
 * `wallet.users` repository (username update).
 */
export class UserDomainImpl implements UserDomain {
  /**
   * @param session - resolves the current agicash {@link User} (enclave id → DB row).
   * @param users - the `wallet.users` repository (username update).
   */
  constructor(
    private readonly session: SessionResolver,
    private readonly users: UserRepository,
  ) {}

  /**
   * The currently signed-in user, or `null` if none.
   *
   * Re-houses master `useUser`: the enclave user id → the `wallet.users` DB row → the
   * domain {@link User}. Returns `null` when signed out.
   *
   * @returns the current {@link User}, or `null`.
   */
  async getCurrentUser(): Promise<User | null> {
    return this.session.getCurrentUser();
  }

  /**
   * Change the signed-in user's username.
   *
   * Re-houses master `useUpdateUsername` → `WriteUserRepository.update({ username })`.
   * Resolves the current user id from the session, updates the row, and returns the fresh
   * {@link User}. Throws {@link DomainError} if the username is already taken (the
   * repository maps the Postgres unique-violation to it).
   *
   * @param username - the new username.
   * @returns the updated {@link User}.
   * @throws DomainError if the username is taken.
   * @throws Error if there is no authenticated user.
   */
  async updateUsername(username: string): Promise<User> {
    const current = await this.session.requireCurrentUser();
    // The realtime forwarder (Slice 5) also surfaces the row change as an event; this
    // returns the fresh user directly so the caller has it without awaiting that.
    return this.users.updateUsername(current.id, username);
  }
}
