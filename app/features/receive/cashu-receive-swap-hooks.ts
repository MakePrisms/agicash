import { PendingCashuReceiveSwapsCache } from '@agicash/sdk/features/receive/cashu-receive-swap-queries';
import type { Token } from '@cashu/cashu-ts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useGetCashuAccount } from '../accounts/account-hooks';
import { useUser } from '../user/user-hooks';
import { useWalletClient } from '../wallet/wallet-client';
import { useCashuReceiveSwapService } from './cashu-receive-swap-service';

type CreateProps = {
  token: Token;
  accountId: string;
};

export function usePendingCashuReceiveSwapsCache() {
  const queryClient = useQueryClient();
  return useMemo(
    () => new PendingCashuReceiveSwapsCache(queryClient),
    [queryClient],
  );
}

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

export function useProcessCashuReceiveSwapTasks() {
  const wallet = useWalletClient();

  useEffect(() => {
    void wallet.taskProcessors.cashuReceiveSwap.start();

    return () => {
      void wallet.taskProcessors.cashuReceiveSwap.stop();
    };
  }, [wallet]);
}
