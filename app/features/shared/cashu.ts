import { CashuMint, type Token, getEncodedToken } from '@cashu/cashu-ts';
import {
  getPrivateKey as getMnemonic,
  getPrivateKeyBytes,
} from '@opensecret/react';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import {
  type QueryClient,
  queryOptions,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { checkIsTestMint, getCashuWallet, sumProofs } from '~/lib/cashu';
import { buildMintValidator } from '~/lib/cashu/mint-validation';
import { type Currency, type CurrencyUnit, Money } from '~/lib/money';
import { computeSHA256 } from '~/lib/sha256';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';

// Cashu-specific derivation path with hardnened indexes to derive public keys for
// locking mint quotes and proofs. 129372 is UTF-8 for 🥜 (see NUT-13) and the other
// 2 indexes are the coin type (0) and account (0) which can be changed to derive
// different keys if needed. This path is "proprietary" and not part of any standard.
// The index values are unimportant as long as they are hardened and remain constant.
// DO NOT CHANGE THIS VALUE WITHOUT UPDATING USER'S XPUB IN THE DATABASE. IF THIS
// IS NOT DONE, THEN WE WILL CREATE THE WRONG DERIVATION PATH WHEN GETTING PRIVATE KEYS.
export const BASE_CASHU_LOCKING_DERIVATION_PATH = "m/129372'/0'/0'";

function getCurrencyAndUnitFromToken(token: Token): {
  currency: Currency;
  unit: CurrencyUnit;
  formatUnit: 'sat' | 'usd';
} {
  if (token.unit === 'sat') {
    return { currency: 'BTC', unit: 'sat', formatUnit: 'sat' };
  }
  if (token.unit === 'usd') {
    return { currency: 'USD', unit: 'cent', formatUnit: 'usd' };
  }
  throw new Error(`Invalid token unit ${token.unit}`);
}

export function tokenToMoney(token: Token): Money {
  const { currency, unit } = getCurrencyAndUnitFromToken(token);
  const amount = sumProofs(token.proofs);
  return new Money<Currency>({
    amount,
    currency,
    unit,
  });
}

export type CashuCryptography = {
  getSeed: () => Promise<Uint8Array>;
  getXpub: (derivationPath?: string) => Promise<string>;
  getPrivateKey: (derivationPath?: string) => Promise<string>;
};

const seedDerivationPath = getSeedPhraseDerivationPath('cashu', 12);

export const seedQueryOptions = () =>
  queryOptions({
    queryKey: ['cashu-seed'],
    queryFn: async () => {
      const response = await getMnemonic({
        seed_phrase_derivation_path: seedDerivationPath,
      });
      return mnemonicToSeedSync(response.mnemonic);
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

export const xpubQueryOptions = ({
  queryClient,
  derivationPath,
}: { queryClient: QueryClient; derivationPath?: string }) =>
  queryOptions({
    queryKey: ['cashu-xpub', derivationPath],
    queryFn: async () => {
      const seed = await queryClient.fetchQuery(seedQueryOptions());
      const hdKey = HDKey.fromMasterSeed(seed);

      if (derivationPath) {
        const childKey = hdKey.derive(derivationPath);
        return childKey.publicExtendedKey;
      }

      return hdKey.publicExtendedKey;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

const privateKeyQueryOptions = ({
  derivationPath,
}: { derivationPath?: string } = {}) =>
  queryOptions({
    queryKey: ['cashu-private-key', derivationPath],
    queryFn: async () => {
      const response = await getPrivateKeyBytes({
        seed_phrase_derivation_path: seedDerivationPath,
        private_key_derivation_path: derivationPath,
      });
      return response.private_key;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

/**
 * Gets Cashu cryptography functions.
 * @returns The Cashu cryptography functions.
 */
export function getCashuCryptography(
  queryClient: QueryClient,
): CashuCryptography {
  return {
    getSeed: () => queryClient.fetchQuery(seedQueryOptions()),
    getXpub: (derivationPath?: string) =>
      queryClient.fetchQuery(xpubQueryOptions({ queryClient, derivationPath })),
    getPrivateKey: (derivationPath?: string) =>
      queryClient.fetchQuery(privateKeyQueryOptions({ derivationPath })),
  };
}

/**
 * Hook that provides the Cashu cryptography functions.
 * Reference of the returned data is stable and doesn't change between renders.
 * @returns The Cashu cryptography functions.
 */
export function useCashuCryptography(): CashuCryptography {
  const queryClient = useQueryClient();

  return useMemo(() => getCashuCryptography(queryClient), [queryClient]);
}

export function getTokenHash(token: Token | string): Promise<string> {
  const encodedToken =
    typeof token === 'string' ? token : getEncodedToken(token);
  return computeSHA256(encodedToken);
}

export const cashuMintValidator = buildMintValidator({
  requiredNuts: [4, 5, 7, 8, 9, 10, 11, 12, 17, 20] as const,
  requiredWebSocketCommands: ['bolt11_melt_quote', 'proof_state'] as const,
});

/**
 * Get the mint info.
 *
 * @param mintUrl
 * @returns The mint info.
 */
export const mintInfoQueryOptions = (mintUrl: string) =>
  queryOptions({
    queryKey: ['mint-info', mintUrl],
    queryFn: async () => getCashuWallet(mintUrl).getMintInfo(),
    staleTime: 1000 * 60 * 60, // 1 hour
    retry: 1,
  });

/**
 * Get the mints keysets in no specific order.
 *
 * @param mintUrl
 * @returns All the mints past and current keysets.
 */
export const allMintKeysetsQueryOptions = (mintUrl: string) =>
  queryOptions({
    queryKey: ['all-mint-keysets', mintUrl],
    queryFn: async () => CashuMint.getKeySets(mintUrl),
    staleTime: 1000 * 60 * 60, // 1 hour
    retry: 1,
  });

/**
 * Get the mints public keys.
 *
 * @param mintUrl
 * @param keysetId Optional param to get the keys for a specific keyset. If not specified, the
 *   keys from all active keysets are fetched.
 * @returns An object with an array of the fetched keysets.
 */
export const mintKeysQueryOptions = (mintUrl: string, keysetId?: string) =>
  queryOptions({
    queryKey: ['mint-keys', mintUrl, keysetId],
    queryFn: async () => CashuMint.getKeys(mintUrl, keysetId),
    staleTime: 1000 * 60 * 60, // 1 hour
    retry: 1,
  });

export const isTestMintQueryOptions = (mintUrl: string) =>
  queryOptions({
    queryKey: ['is-test-mint', mintUrl],
    queryFn: async () => checkIsTestMint(mintUrl),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
