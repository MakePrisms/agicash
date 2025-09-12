import type { Token } from '@cashu/cashu-ts';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  areMintUrlsEqual,
  getCashuProtocolUnit,
  getCashuUnit,
  getCashuWallet,
} from '~/lib/cashu';
import {
  allMintKeysetsQuery,
  cashuMintValidator,
  isTestMintQuery,
  mintInfoQuery,
  tokenToMoney,
} from '../shared/cashu';
import type { ExtendedCashuAccount } from './account';

export class CashuAccountService {
  constructor(private readonly queryClient: QueryClient) {}

  async getSourceAccount(token: Token, accounts: ExtendedCashuAccount[] = []) {
    const tokenCurrency = tokenToMoney(token).currency;
    const existingAccount = accounts.find(
      (a) =>
        areMintUrlsEqual(a.mintUrl, token.mint) && a.currency === tokenCurrency,
    );
    if (existingAccount) {
      return {
        isValid: true,
        isNew: false,
        data: existingAccount,
      };
    }

    const [info, keysets, isTestMint] = await Promise.all([
      this.queryClient.fetchQuery(mintInfoQuery(token.mint)),
      this.queryClient.fetchQuery(allMintKeysetsQuery(token.mint)),
      this.queryClient.fetchQuery(isTestMintQuery(token.mint)),
    ]);

    const validationResult = cashuMintValidator(
      token.mint,
      getCashuProtocolUnit(tokenCurrency),
      info,
      keysets.keysets,
    );

    return {
      isValid: validationResult === true,
      isNew: true,
      data: {
        id: '',
        type: 'cashu',
        mintUrl: token.mint,
        createdAt: new Date().toISOString(),
        name: info?.name ?? token.mint.replace('https://', ''),
        currency: tokenCurrency,
        isTestMint,
        version: 0,
        keysetCounters: {},
        proofs: [],
        isDefault: false,
        wallet: getCashuWallet(token.mint, {
          unit: getCashuUnit(tokenCurrency),
          mintInfo: info,
        }),
      } satisfies ExtendedCashuAccount,
    };
  }
}

export function useCashuAccountService() {
  const queryClient = useQueryClient();
  return new CashuAccountService(queryClient);
}
