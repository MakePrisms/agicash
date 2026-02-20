export { ContactRepository } from '@agicash/core/features/contacts/contact-repository';
import { ContactRepository } from '@agicash/core/features/contacts/contact-repository';
import useLocationData from '~/hooks/use-location';
import { agicashDbClient } from '../agicash-db/database.client';

export function useContactRepository() {
  const { domain } = useLocationData();
  return new ContactRepository(agicashDbClient, domain);
}
