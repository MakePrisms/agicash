import type { AgicashDbUser } from '@agicash/db-types';
import type { QueryClient } from '@tanstack/query-core';
import type { User } from './user';
import { ReadUserRepository } from './user-repository';

export class UserCache {
  public static Key = 'user';

  constructor(private readonly queryClient: QueryClient) {}

  set(user: User) {
    this.queryClient.setQueryData([UserCache.Key], user);
  }

  get(): User | undefined {
    return this.queryClient.getQueryData<User>([UserCache.Key]);
  }

  invalidate() {
    return this.queryClient.invalidateQueries({ queryKey: [UserCache.Key] });
  }
}

/**
 * Query options for the current user. The queryFn fetches from the DB; in
 * practice the user is pre-populated via cache.set() during the bootstrap
 * upsert and the queryFn only fires on refetch. The id is resolved at fetch
 * time (not captured at options creation) so a long-lived observer can never
 * pin a previous session's id across an account switch.
 */
export const userQueryOptions = ({
  getUserId,
  userRepository,
}: {
  getUserId: () => string;
  userRepository: ReadUserRepository;
}) => ({
  queryKey: [UserCache.Key],
  queryFn: () => userRepository.get(getUserId()),
});

/**
 * Supabase Realtime change handlers for the user domain. No version-guard
 * (unlike accounts): wallet.users has no version column, so the latest
 * realtime payload wins.
 */
export const createUserChangeHandlers = (cache: UserCache) => [
  {
    event: 'USER_UPDATED',
    handleEvent: async (payload: AgicashDbUser) => {
      cache.set(ReadUserRepository.toUser(payload));
    },
  },
];
