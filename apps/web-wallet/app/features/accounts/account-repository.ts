// The AccountRepository class moved to @agicash/wallet-sdk; the re-export is
// removed in the import-cleanup PR. The React wiring hook below stays in the
// web app.
import { AccountRepository } from '@agicash/wallet-sdk/accounts/account-repository';
import { sparkMnemonicQueryOptions } from '@agicash/wallet-sdk/spark';
import { useQueryClient } from '@tanstack/react-query';
import { agicashDbClient } from '../agicash-db/database.client';
import { useCashuCryptography } from '../shared/cashu';
import { useEncryption } from '../shared/encryption';

export * from '@agicash/wallet-sdk/accounts/account-repository';

export function useAccountRepository() {
  const encryption = useEncryption();
  const queryClient = useQueryClient();
  const { getSeed: getCashuWalletSeed } = useCashuCryptography();
  const getSparkWalletMnemonic = () =>
    queryClient.fetchQuery(sparkMnemonicQueryOptions());
  return new AccountRepository({
    db: agicashDbClient,
    encryption,
    queryClient,
    getCashuWalletSeed,
    getSparkWalletMnemonic,
    sparkStorageDir: './.spark-data',
  });
}
