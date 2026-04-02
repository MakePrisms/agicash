import { createWalletClient } from '@agicash/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { agicashDbClient } from '../agicash-db/database.client';
import { createWebKeyProvider } from '../shared/cashu';
import { useUser } from '../user/user-hooks';

export function useWalletClient() {
  const queryClient = useQueryClient();
  const userId = useUser((user) => user.id);
  const keyProvider = useMemo(() => createWebKeyProvider(), []);

  return useMemo(
    () =>
      createWalletClient({
        db: agicashDbClient,
        keyProvider,
        queryClient,
        userId,
      }),
    [keyProvider, queryClient, userId],
  );
}
