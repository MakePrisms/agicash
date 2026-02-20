export { CashuSendSwapRepository } from '@agicash/core/features/send/cashu-send-swap-repository';
import { CashuSendSwapRepository } from '@agicash/core/features/send/cashu-send-swap-repository';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';

export function useCashuSendSwapRepository() {
  const encryption = useEncryption();
  return new CashuSendSwapRepository(agicashDbClient, encryption);
}
