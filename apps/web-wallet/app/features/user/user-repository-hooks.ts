import {
  ReadUserRepository,
  WriteUserRepository,
} from '@agicash/wallet-sdk/temporary';
import { agicashDbClient } from '~/features/agicash-db/database.client';

export function useReadUserRepository() {
  return new ReadUserRepository(agicashDbClient);
}

export function useWriteUserRepository() {
  return new WriteUserRepository(agicashDbClient);
}
