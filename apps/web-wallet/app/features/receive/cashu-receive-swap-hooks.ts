import type { Token } from '@cashu/cashu-ts';
import { useMutation } from '@tanstack/react-query';
import { useGetCashuAccount } from '../accounts/account-hooks';
import { useUser } from '../user/user-hooks';
import { useCashuReceiveSwapService } from './cashu-receive-swap-service';

type CreateProps = {
  token: Token;
  accountId: string;
};

export function useCreateCashuReceiveSwap() {
  const userId = useUser((user) => user.id);
  const receiveSwapService = useCashuReceiveSwapService();
  const getCashuAccount = useGetCashuAccount();

  return useMutation({
    mutationKey: ['create-cashu-receive-swap'],
    scope: {
      id: 'create-cashu-receive-swap',
    },
    mutationFn: ({ token, accountId }: CreateProps) => {
      const account = getCashuAccount(accountId);
      return receiveSwapService.create({
        userId,
        token,
        account,
      });
    },
  });
}
