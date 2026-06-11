import { MintBlocklistSchema, buildMintValidator } from '@agicash/cashu';
// The env-derived mint validator and the React cashu-cryptography hook. The
// framework-free cashu connection layer lives in @agicash/wallet-sdk/cashu.
import {
  type CashuCryptography,
  getCashuCryptography,
} from '@agicash/wallet-sdk/cashu';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

const mintBlocklist = MintBlocklistSchema.parse(
  JSON.parse(import.meta.env.VITE_CASHU_MINT_BLOCKLIST ?? '[]'),
);

export const cashuMintValidator = buildMintValidator({
  requiredNuts: [4, 5, 7, 8, 9, 10, 11, 12, 17, 20] as const,
  requiredWebSocketCommands: ['bolt11_melt_quote', 'proof_state'] as const,
  blocklist: mintBlocklist,
});

/**
 * Hook that provides the Cashu cryptography functions.
 * Reference of the returned data is stable and doesn't change between renders.
 * @returns The Cashu cryptography functions.
 */
export function useCashuCryptography(): CashuCryptography {
  const queryClient = useQueryClient();

  return useMemo(() => getCashuCryptography(queryClient), [queryClient]);
}
