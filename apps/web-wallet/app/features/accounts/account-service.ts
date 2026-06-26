import {
  checkIsTestMint,
  findFirstActiveKeyset,
  getKeysetExpiry,
} from '@agicash/cashu';
import type { QueryClient } from '@tanstack/react-query';
import type { DistributedOmit } from 'type-fest';
import { allMintKeysetsQueryOptions } from '~/features/shared/cashu';
import type { CashuAccount } from './account';
import {
  type AccountRepository,
  useAccountRepository,
} from './account-repository';

export class AccountService {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly queryClient: QueryClient,
  ) {}

  async addCashuAccount({
    userId,
    account,
  }: {
    userId: string;
    account: DistributedOmit<
      CashuAccount,
      | 'id'
      | 'createdAt'
      | 'expiresAt'
      | 'isTestMint'
      | 'keysetCounters'
      | 'proofs'
      | 'version'
      | 'wallet'
      | 'isOnline'
      | 'state'
    >;
  }) {
    const isTestMint = checkIsTestMint(account.mintUrl);

    let expiresAt: string | null = null;
    if (account.purpose === 'offer') {
      const { keysets } = await this.queryClient.fetchQuery(
        allMintKeysetsQueryOptions(account.mintUrl),
      );
      const activeKeyset = findFirstActiveKeyset(keysets, account.currency);
      if (activeKeyset) {
        expiresAt = getKeysetExpiry(activeKeyset)?.toISOString() ?? null;
      }
    }

    return this.accountRepository.create<CashuAccount>({
      ...account,
      userId,
      isTestMint,
      expiresAt,
      keysetCounters: {},
    });
  }
}

export function useAccountService(queryClient: QueryClient) {
  const accountRepository = useAccountRepository();
  return new AccountService(accountRepository, queryClient);
}
