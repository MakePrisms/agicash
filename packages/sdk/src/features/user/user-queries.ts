import type { FetchQueryOptions } from '@tanstack/query-core';
import { userQueryKey } from '../../core/query-keys';
import type { User } from './user';
import type { ReadUserRepository } from './user-repository';

export { userQueryKey };

export const userQuery = ({
  userId,
  readUserRepository,
}: {
  userId: string;
  readUserRepository: ReadUserRepository;
}) =>
  ({
    queryKey: userQueryKey(),
    queryFn: () => readUserRepository.get(userId),
    staleTime: Number.POSITIVE_INFINITY,
  }) satisfies FetchQueryOptions<User, Error>;
