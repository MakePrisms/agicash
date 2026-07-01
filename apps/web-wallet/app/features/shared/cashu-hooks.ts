import type { CashuCryptography } from '@agicash/wallet-sdk/temporary';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getCashuCryptography } from './cashu-query-options';

/**
 * Hook that provides the Cashu cryptography functions.
 * Reference of the returned data is stable and doesn't change between renders.
 * @returns The Cashu cryptography functions.
 */
export function useCashuCryptography(): CashuCryptography {
  const queryClient = useQueryClient();

  return useMemo(() => getCashuCryptography(queryClient), [queryClient]);
}
