// Transitional re-export — moved to @agicash/wallet-sdk; removed in the import-cleanup PR.
export { UserService } from '@agicash/wallet-sdk';
import { UserService } from '@agicash/wallet-sdk';
import { useWriteUserRepository } from './user-repository';

export function useUserService() {
  const userRepository = useWriteUserRepository();
  return new UserService(userRepository);
}
