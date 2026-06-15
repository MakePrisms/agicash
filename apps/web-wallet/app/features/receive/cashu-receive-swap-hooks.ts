import type { Token } from '@cashu/cashu-ts';
import { useMutation } from '@tanstack/react-query';
import { useGetCashuAccount } from '../accounts/account-hooks';
import { getSdk } from '../shared/sdk';

type CreateProps = {
  token: Token;
  accountId: string;
};

export function useCreateCashuReceiveSwap() {
  const getCashuAccount = useGetCashuAccount();

  return useMutation({
    mutationKey: ['create-cashu-receive-swap'],
    scope: {
      id: 'create-cashu-receive-swap',
    },
    mutationFn: ({ token, accountId }: CreateProps) => {
      const account = getCashuAccount(accountId);
      return getSdk().receive.createCashuReceiveSwap({ token, account });
    },
  });
}
