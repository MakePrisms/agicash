export { AccountRepository } from '@agicash/core/features/accounts/account-repository';
import { AccountRepository } from '@agicash/core/features/accounts/account-repository';
import { useQueryClient } from '@tanstack/react-query';
import { queryClientAsCache } from '~/lib/cache-adapter';
import { agicashDbClient } from '../agicash-db/database.client';
import { useCashuCryptography } from '../shared/cashu';
import { useEncryption } from '../shared/encryption';
import { sparkMnemonicQueryOptions } from '../shared/spark';

export function useAccountRepository() {
  const encryption = useEncryption();
  const queryClient = useQueryClient();
  const { getSeed: getCashuWalletSeed } = useCashuCryptography();
  const getSparkWalletMnemonic = () =>
    queryClient.fetchQuery(sparkMnemonicQueryOptions());
  return new AccountRepository(
    agicashDbClient,
    encryption,
    queryClientAsCache(queryClient),
    getCashuWalletSeed,
    getSparkWalletMnemonic,
  );
}
