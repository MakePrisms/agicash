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
  mintKeysQuery,
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

    const [info, keysets, keys, isTestMint] = await Promise.all([
      this.queryClient.fetchQuery(mintInfoQuery(token.mint)),
      this.queryClient.fetchQuery(allMintKeysetsQuery(token.mint)),
      this.queryClient.fetchQuery(mintKeysQuery(token.mint)),
      this.queryClient.fetchQuery(isTestMintQuery(token.mint)),
    ]);

    const unit = getCashuProtocolUnit(tokenCurrency);
    const validationResult = cashuMintValidator(
      token.mint,
      unit,
      info,
      keysets.keysets,
    );

    const unitKeysets = keysets.keysets.filter((ks) => ks.unit === unit);
    const activeKeyset = unitKeysets.find((ks) => ks.active);

    if (!activeKeyset) {
      throw new Error(
        `No active keyset found for ${tokenCurrency} on ${token.mint}`,
      );
    }

    const activeKeysForUnit = keys.keysets.find(
      (ks) => ks.id === activeKeyset.id,
    );

    if (!activeKeysForUnit) {
      throw new Error(
        `Got active keyset ${activeKeyset.id} from ${token.mint} but could not find keys for it`,
      );
    }

    const wallet = getCashuWallet(token.mint, {
      unit: getCashuUnit(tokenCurrency),
      mintInfo: info,
      keys: activeKeysForUnit,
      keysets: unitKeysets,
    });

    wallet.keysetId = activeKeyset.id;

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
        wallet,
      } satisfies ExtendedCashuAccount,
    };
  }
}

export function useCashuAccountService() {
  const queryClient = useQueryClient();
  return new CashuAccountService(queryClient);
}
