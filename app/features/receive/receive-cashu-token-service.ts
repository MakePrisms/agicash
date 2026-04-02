export { ReceiveCashuTokenService } from '@agicash/sdk/features/receive/receive-cashu-token-service';

import { ReceiveCashuTokenService } from '@agicash/sdk/features/receive/receive-cashu-token-service';
import { useQueryClient } from '@tanstack/react-query';
import { queryClientAsCache } from '~/lib/cache-adapter';
import { cashuMintValidator } from '../shared/cashu';
import { getFeatureFlag } from '../shared/feature-flags';

export function useReceiveCashuTokenService() {
  const queryClient = useQueryClient();
  return new ReceiveCashuTokenService(
    queryClientAsCache(queryClient),
    (flag: string) =>
      getFeatureFlag(flag as Parameters<typeof getFeatureFlag>[0]),
    cashuMintValidator,
  );
}
