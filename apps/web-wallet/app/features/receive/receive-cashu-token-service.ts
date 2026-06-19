import type { Currency } from '@agicash/money';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  checkIsTestMint,
  findFirstActiveKeyset,
  getCashuProtocolUnit,
  getKeysetExpiry,
} from '@agicash/cashu';
import { cashuMintValidator, getInitializedCashuWallet } from '../shared/cashu';
import type { CashuAccountWithTokenFlags } from '@agicash/wallet-sdk';

export class ReceiveCashuTokenService {
  constructor(private readonly queryClient: QueryClient) {}

  /**
   * Builds a cashu account object for a given mint and currency.
   * This account is not stored in the database, and has placeholder values for the id and createdAt.
   * @param mintUrl - The mint URL.
   * @param currency - The currency.
   * @returns The cashu account.
   */
  async buildAccountForMint(
    mintUrl: string,
    currency: Currency,
  ): Promise<CashuAccountWithTokenFlags> {
    const { wallet, isOnline } = await getInitializedCashuWallet({
      queryClient: this.queryClient,
      mintUrl,
      currency,
    });

    let expiresAt: string | null = null;
    if (wallet.purpose === 'offer') {
      const activeKeyset = findFirstActiveKeyset(
        wallet.keyChain.getKeysets(),
        currency,
      );
      if (activeKeyset) {
        expiresAt = getKeysetExpiry(activeKeyset)?.toISOString() ?? null;
      }
    }

    const isExpired = expiresAt !== null && new Date(expiresAt) <= new Date();

    const baseAccount = {
      id: 'cashu-account-placeholder-id',
      type: 'cashu' as const,
      purpose: wallet.purpose,
      state: isExpired ? ('expired' as const) : ('active' as const),
      name: mintUrl.replace('https://', '').replace('http://', ''),
      mintUrl,
      createdAt: new Date().toISOString(),
      currency,
      version: 0,
      keysetCounters: {},
      expiresAt,
      proofs: [],
      isDefault: false,
      isSource: true,
      isUnknown: true,
      wallet,
    };

    if (!isOnline || isExpired) {
      return {
        ...baseAccount,
        canReceive: false,
        cannotReceiveReason: isExpired ? 'This offer has expired' : undefined,
        isOnline,
        isTestMint: false,
      };
    }

    const mintInfo = wallet.getMintInfo();
    const unit = getCashuProtocolUnit(currency);
    const validationResult = cashuMintValidator(
      mintUrl,
      unit,
      mintInfo,
      wallet.keyChain.getKeysets().map((ks) => ks.toMintKeyset()),
    );

    const isTestMint = checkIsTestMint(mintUrl);

    const isValid = validationResult === true;

    return {
      ...baseAccount,
      name: mintInfo.name || baseAccount.name,
      isTestMint,
      canReceive: isValid,
      isOnline,
    };
  }
}

export function useReceiveCashuTokenService() {
  const queryClient = useQueryClient();
  return new ReceiveCashuTokenService(queryClient);
}
