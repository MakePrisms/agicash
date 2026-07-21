import {
  checkIsTestMint,
  findFirstActiveKeyset,
  getKeysetExpiry,
} from '@agicash/cashu';
import { Mint } from '@cashu/cashu-ts';
import type { DistributedOmit } from 'type-fest';
import type { CashuAccount } from './account';
import type { AccountRepository } from './account-repository';

export class AccountService {
  constructor(private readonly accountRepository: AccountRepository) {}

  async addCashuAccount(
    {
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
    },
    options?: { abortSignal?: AbortSignal },
  ) {
    const isTestMint = checkIsTestMint(account.mintUrl);

    let expiresAt: string | null = null;
    if (account.purpose === 'offer') {
      const { keysets } = await new Mint(account.mintUrl).getKeySets();
      const activeKeyset = findFirstActiveKeyset(keysets, account.currency);
      if (activeKeyset) {
        expiresAt = getKeysetExpiry(activeKeyset)?.toISOString() ?? null;
      }
    }

    return this.accountRepository.create<CashuAccount>(
      {
        ...account,
        userId,
        isTestMint,
        expiresAt,
        keysetCounters: {},
      },
      options,
    );
  }
}
