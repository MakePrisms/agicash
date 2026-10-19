import type { CashuAccount } from '@agicash/wallet-sdk';
import {
  CashuReceiveSwapRepository,
  CashuReceiveSwapService,
} from '@agicash/wallet-sdk/temporary';
import type { Token } from '@cashu/cashu-ts';
import { useMutation } from '@tanstack/react-query';
import { useAccountRepository } from '~/features/accounts/account-repository-hooks';
import { sdk } from '~/features/shared/sdk.client';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption-hooks';

type CreateProps = {
  token: Token;
  account: CashuAccount;
};

export function useCashuReceiveSwapRepository() {
  const encryption = useEncryption();
  const accountRepository = useAccountRepository();
  return new CashuReceiveSwapRepository(
    agicashDbClient,
    encryption,
    accountRepository,
  );
}

export function useCashuReceiveSwapService() {
  const receiveSwapRepository = useCashuReceiveSwapRepository();
  return new CashuReceiveSwapService(receiveSwapRepository);
}

export function useCreateCashuReceiveSwap() {
  return useMutation({
    mutationKey: ['create-cashu-receive-swap'],
    scope: {
      id: 'create-cashu-receive-swap',
    },
    mutationFn: ({ token, account }: CreateProps) =>
      sdk.receive.cashu.createSwap({ token, account }),
  });
}
