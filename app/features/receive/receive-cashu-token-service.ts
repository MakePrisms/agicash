export { ReceiveCashuTokenService } from '@agicash/core/features/receive/receive-cashu-token-service';
import { ReceiveCashuTokenService } from '@agicash/core/features/receive/receive-cashu-token-service';
import { useQueryClient } from '@tanstack/react-query';
import { queryClientAsCache } from '~/lib/cache-adapter';

export function useReceiveCashuTokenService() {
  const queryClient = useQueryClient();
  return new ReceiveCashuTokenService(queryClientAsCache(queryClient));
}
