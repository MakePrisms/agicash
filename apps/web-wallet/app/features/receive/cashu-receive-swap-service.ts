// The CashuReceiveSwapService class moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR.
import { CashuReceiveSwapService } from '@agicash/wallet-sdk/receive/cashu-receive-swap-service';
import { useCashuReceiveSwapRepository } from './cashu-receive-swap-repository';

export * from '@agicash/wallet-sdk/receive/cashu-receive-swap-service';

/**
 * Transitional: construction moves behind sdk.receive in the receive-api
 * chunk; the hook exists only for the not-yet-migrated receive hooks/UI.
 */
export function useCashuReceiveSwapService() {
  const receiveSwapRepository = useCashuReceiveSwapRepository();
  return new CashuReceiveSwapService(receiveSwapRepository);
}
