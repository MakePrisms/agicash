import {
  checkIsTestMint,
  findFirstActiveKeyset,
  getKeysetExpiry,
} from '@agicash/cashu';
import type { QueryClient } from '@tanstack/query-core';
import { allMintKeysetsQueryOptions } from '../cashu';
import type { CashuAccount, NewCashuAccount } from './account';
import type { AccountRepository } from './account-repository';

export type AccountServiceDeps = {
  accountRepository: AccountRepository;
  queryClient: QueryClient;
};

export class AccountService {
  private readonly accountRepository: AccountRepository;
  private readonly queryClient: QueryClient;

  constructor(deps: AccountServiceDeps) {
    this.accountRepository = deps.accountRepository;
    this.queryClient = deps.queryClient;
  }

  async addCashuAccount({
    userId,
    account,
  }: {
    userId: string;
    account: NewCashuAccount;
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
