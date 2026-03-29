export { CashuReceiveSwapService } from '@agicash/sdk/features/receive/cashu-receive-swap-service';

import { CashuReceiveSwapService } from '@agicash/sdk/features/receive/cashu-receive-swap-service';
import { useCashuReceiveSwapRepository } from './cashu-receive-swap-repository';

export function useCashuReceiveSwapService() {
  const receiveSwapRepository = useCashuReceiveSwapRepository();
  return new CashuReceiveSwapService(receiveSwapRepository);
}
