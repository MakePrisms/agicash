import { getPrivateKeyBytes, getPublicKey } from '@opensecret/react';
import { useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { useMemo } from 'react';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';

const seedDerivationPath = getSeedPhraseDerivationPath('nostr', 12);

const privateKeyQuery = ({
  derivationPath,
}: { derivationPath?: string } = {}) => ({
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

const publicKeyQuery = ({
  derivationPath,
}: { derivationPath?: string } = {}) => ({
  queryKey: ['cashu-public-key', derivationPath],
  queryFn: async () => {
    const response = await getPublicKey('schnorr', {
      seed_phrase_derivation_path: seedDerivationPath,
      private_key_derivation_path: derivationPath,
    });
    const hexPublicKey = response.public_key;
    const npub = nip19.npubEncode(hexPublicKey);
    return { hexPublicKey, npub };
  },
  staleTime: Number.POSITIVE_INFINITY,
});

export const useNostrCryptography = () => {
  const queryClient = useQueryClient();

  return useMemo(() => {
    const getPrivateKey = (derivationPath?: string) =>
      queryClient.fetchQuery(privateKeyQuery({ derivationPath }));

    const getPublicKey = (derivationPath?: string) =>
      queryClient.fetchQuery(publicKeyQuery({ derivationPath }));

    return { getPrivateKey, getPublicKey };
  }, [queryClient]);
};
