export { CashuSendSwapRepository } from '@agicash/sdk/features/send/cashu-send-swap-repository';
import { CashuSendSwapRepository } from '@agicash/sdk/features/send/cashu-send-swap-repository';
import { useEncryption } from '../shared/encryption';
import { agicashDbClient } from '../agicash-db/database.client';

export function useCashuSendSwapRepository() {
  const encryption = useEncryption();
  return new CashuSendSwapRepository(agicashDbClient, encryption);
}
