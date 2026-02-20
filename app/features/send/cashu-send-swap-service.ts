export {
  CashuSendSwapService,
  type CashuSwapQuote,
} from '@agicash/core/features/send/cashu-send-swap-service';
import { CashuSendSwapService } from '@agicash/core/features/send/cashu-send-swap-service';
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
