// The framework-free cashu connection layer (crypto queryOptions, mint
// queryOptions, wallet init) moved to @agicash/wallet-sdk; the re-export is
// removed in the import-cleanup PR. The env-derived mint validator and the
// React hook below stay in the web app.
import {
  type CashuCryptography,
  getCashuCryptography,
} from '@agicash/wallet-sdk/cashu';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  MintBlocklistSchema,
  buildMintValidator,
} from '~/lib/cashu/mint-validation';

export * from '@agicash/wallet-sdk/cashu';

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
