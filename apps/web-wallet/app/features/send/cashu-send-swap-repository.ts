// The CashuSendSwapRepository class moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR.
import { CashuSendSwapRepository } from '@agicash/wallet-sdk/send/cashu-send-swap-repository';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';

export * from '@agicash/wallet-sdk/send/cashu-send-swap-repository';

/**
 * Transitional: construction moves behind sdk.send in the send-api chunk;
 * the hook exists only for the not-yet-migrated send hooks/UI.
 */
export function useCashuSendSwapRepository() {
  const encryption = useEncryption();
  return new CashuSendSwapRepository(agicashDbClient, encryption);
}
