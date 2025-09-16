import type { Token } from '@cashu/cashu-ts';
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { getTokenHash } from '../shared/cashu';
import {
  type AnonLockedTokenRepository,
  useAnonLockedTokenRepository,
  useLockedTokenRepository,
} from './locked-token-repository';

type CreateProps = {
  token: Token;
  userId: string;
  accessCode?: string;
};

export function useCreateLockedToken() {
  const repository = useLockedTokenRepository();

  return useMutation({
    mutationFn: async (props: CreateProps) => {
      const { token, accessCode, userId } = props;

      const tokenHash = await getTokenHash(token);

      return repository.createLockedToken({
        tokenHash,
        token,
        accessCode,
        userId,
      });
    },
  });
}

export const lockedTokenQueryOptions = ({
  tokenHash,
  accessCode,
  repository,
}: {
  tokenHash: string;
  accessCode?: string;
  repository: AnonLockedTokenRepository;
}) => {
  return queryOptions({
    queryKey: ['lockedToken', tokenHash, accessCode],
    queryFn: () => repository.getLockedToken({ tokenHash, accessCode }),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: !!tokenHash,
  });
};

export const useGetLockedToken = () => {
  const queryClient = useQueryClient();
  const repository = useAnonLockedTokenRepository();
  return async (tokenHash: string, accessCode?: string) =>
    queryClient.fetchQuery(
      lockedTokenQueryOptions({ tokenHash, accessCode, repository }),
    );
};
