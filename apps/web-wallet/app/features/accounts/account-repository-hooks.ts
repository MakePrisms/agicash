import {
  AccountRepository,
  sparkMnemonicQueryOptions,
} from '@agicash/wallet-sdk/temporary';
import { useQueryClient } from '@tanstack/react-query';
import { agicashDbClient } from '~/features/agicash-db/database.client';
import { isLoggedIn } from '~/features/shared/auth';
import { useCashuCryptography } from '~/features/shared/cashu-hooks';
import { useEncryption } from '~/features/shared/encryption-hooks';

export function useAccountRepository() {
  const encryption = useEncryption();
  const queryClient = useQueryClient();
  const { getSeed: getCashuWalletSeed } = useCashuCryptography();
  const getSparkWalletMnemonic = () =>
    queryClient.fetchQuery(sparkMnemonicQueryOptions());
  return new AccountRepository(
    agicashDbClient,
    encryption,
    getCashuWalletSeed,
    getSparkWalletMnemonic,
    './.spark-data',
    isLoggedIn,
  );
}
