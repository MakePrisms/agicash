// The ReceiveCashuTokenService class moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR. The env-derived
// cashuMintValidator stays web and is injected here.
import { ReceiveCashuTokenService } from '@agicash/wallet-sdk/receive/receive-cashu-token-service';
import { useQueryClient } from '@tanstack/react-query';
import { cashuMintValidator } from '../shared/cashu';

export * from '@agicash/wallet-sdk/receive/receive-cashu-token-service';

/**
 * Transitional: construction moves behind sdk.receive in the receive-api
 * chunk; the hook exists only for the not-yet-migrated receive hooks/UI.
 */
export function useReceiveCashuTokenService() {
  const queryClient = useQueryClient();
  return new ReceiveCashuTokenService(queryClient, cashuMintValidator);
}
