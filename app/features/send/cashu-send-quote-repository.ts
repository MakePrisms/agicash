export { CashuSendQuoteRepository } from '@agicash/core/features/send/cashu-send-quote-repository';
import { CashuSendQuoteRepository } from '@agicash/core/features/send/cashu-send-quote-repository';
import { agicashDbClient } from '../agicash-db/database.client';
import { useEncryption } from '../shared/encryption';

export function useCashuSendQuoteRepository() {
  const encryption = useEncryption();
  return new CashuSendQuoteRepository(agicashDbClient, encryption);
}
