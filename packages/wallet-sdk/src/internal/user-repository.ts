/**
 * Internal `wallet.users` repository — Slice 1 (auth + user).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/user/user-repository.ts`
 * (`ReadUserRepository.get` + `WriteUserRepository.update`). Master expresses these as
 * React-hook-constructed repositories over the TanStack-wired Supabase client; here they
 * are plain async methods over the SDK-owned client (passed in), reading/writing the
 * `wallet.users` table and mapping rows via {@link dbUserToUser}.
 *
 * Only the two reads/writes the auth + user domains need are ported: fetch-by-id and
 * username update. The rest of master's user repository (upsert-with-accounts, default
 * account resolution) belongs to later slices.
 *
 * @module
 */
import { DomainError, NotFoundError } from '../errors';
import type { User } from '../types/user';
import { type AgicashDbUser, dbUserToUser } from './db-user';
import type { WalletSupabaseClient } from './supabase-client';

/**
 * Postgres unique-violation SQLSTATE. The `wallet.users.username` column is unique, so a
 * `23505` on the username update means the chosen username is already taken — surfaced as
 * a {@link DomainError} (the contract's `updateUsername` "throws DomainError if taken").
 * Master raises `UniqueConstraintError` here; the SDK collapses it to `DomainError`.
 */
const UNIQUE_VIOLATION = '23505';

/**
 * Reads + writes for the `wallet.users` table, scoped (via RLS) to the signed-in user.
 *
 * Holds the SDK-owned Supabase client. Methods take the `userId` (the OpenSecret user id)
 * the auth/user domain resolves from the current session.
 */
export class UserRepository {
  /**
   * @param db - the SDK-owned Supabase client (schema pinned to `wallet`).
   */
  constructor(private readonly db: WalletSupabaseClient) {}

  /**
   * Fetch the `wallet.users` row for `userId` and map it to the domain {@link User}.
   *
   * Verbatim logic from master `ReadUserRepository.get` (+ the row→domain mapping), minus
   * the abort-signal plumbing. A missing row surfaces as {@link NotFoundError}.
   *
   * @param userId - the user id (matches the OpenSecret user id).
   * @returns the domain user.
   * @throws NotFoundError if no row exists for `userId`.
   * @throws Error if the read otherwise fails.
   */
  async get(userId: string): Promise<User> {
    const { data, error } = await this.db
      .from('users')
      .select()
      .eq('id', userId)
      .maybeSingle<AgicashDbUser>();

    if (error) {
      throw new Error('Failed to get user', { cause: error });
    }
    if (!data) {
      throw new NotFoundError(`User ${userId} not found`, 'USER_NOT_FOUND');
    }

    return dbUserToUser(data);
  }

  /**
   * Update the user's username and return the updated domain {@link User}.
   *
   * Verbatim logic from master `WriteUserRepository.update` (the `username` path): updates
   * the row, selects it back, and maps it. A unique-violation ({@link UNIQUE_VIOLATION})
   * means the username is taken → {@link DomainError} (master raised `UniqueConstraintError`;
   * the SDK surfaces the contract's `DomainError`).
   *
   * @param userId - the user id.
   * @param username - the new username.
   * @returns the updated domain user.
   * @throws DomainError if the username is already taken.
   * @throws Error if the update otherwise fails.
   */
  async updateUsername(userId: string, username: string): Promise<User> {
    const { data, error } = await this.db
      .from('users')
      .update({ username })
      .eq('id', userId)
      .select()
      .single<AgicashDbUser>();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new DomainError(
          'This username is already taken',
          'USERNAME_TAKEN',
        );
      }
      throw new Error('Failed to update user', { cause: error });
    }

    return dbUserToUser(data);
  }
}
