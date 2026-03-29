export {
  CashuSendSwapService,
  type CashuSwapQuote,
  type CashuReceiveSwapServiceLike,
} from '@agicash/sdk/features/send/cashu-send-swap-service';
import { CashuSendSwapService } from '@agicash/sdk/features/send/cashu-send-swap-service';
import { useCashuReceiveSwapService } from '../receive/cashu-receive-swap-service';
import { useCashuSendSwapRepository } from './cashu-send-swap-repository';

export function useCashuSendSwapService() {
  const cashuSendSwapRepository = useCashuSendSwapRepository();
  const cashuReceiveSwapService = useCashuReceiveSwapService();
  return new CashuSendSwapService(
    cashuSendSwapRepository,
    cashuReceiveSwapService,
  );
}
