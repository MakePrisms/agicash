// The CashuSendSwapService class moved to @agicash/wallet-sdk; the
// re-export is removed in the import-cleanup PR.
import { CashuSendSwapService } from '@agicash/wallet-sdk/send/cashu-send-swap-service';
import { useCashuReceiveSwapService } from '../receive/cashu-receive-swap-service';
import { useCashuSendSwapRepository } from './cashu-send-swap-repository';

export * from '@agicash/wallet-sdk/send/cashu-send-swap-service';

/**
 * Transitional: construction moves behind sdk.send in the send-api chunk;
 * the hook exists only for the not-yet-migrated send hooks/UI.
 */
export function useCashuSendSwapService() {
  const cashuSendSwapRepository = useCashuSendSwapRepository();
  const cashuReceiveSwapService = useCashuReceiveSwapService();
  return new CashuSendSwapService(
    cashuSendSwapRepository,
    cashuReceiveSwapService,
  );
}
