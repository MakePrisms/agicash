import { ContactRepository } from '@agicash/wallet-sdk/temporary';
import { agicashDbClient } from '~/features/agicash-db/database.client';
import useLocationData from '~/hooks/use-location';

export function useContactRepository() {
  const { domain } = useLocationData();
  return new ContactRepository(agicashDbClient, domain);
}
