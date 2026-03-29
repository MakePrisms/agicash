export { CashuSendQuoteRepository } from '@agicash/sdk/features/send/cashu-send-quote-repository';
import { CashuSendQuoteRepository } from '@agicash/sdk/features/send/cashu-send-quote-repository';
import { useEncryption } from '../shared/encryption';
import { agicashDbClient } from '../agicash-db/database.client';

export function useCashuSendQuoteRepository() {
  const encryption = useEncryption();
  return new CashuSendQuoteRepository(agicashDbClient, encryption);
}
