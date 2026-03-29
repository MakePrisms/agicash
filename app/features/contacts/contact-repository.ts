export { ContactRepository } from '@agicash/sdk/features/contacts/contact-repository';

import useLocationData from '~/hooks/use-location';
import { agicashDbClient } from '../agicash-db/database.client';
import { ContactRepository } from '@agicash/sdk/features/contacts/contact-repository';

export function useContactRepository() {
  const { domain } = useLocationData();
  return new ContactRepository(agicashDbClient, domain);
}
