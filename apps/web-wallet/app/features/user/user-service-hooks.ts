import { UserService } from '@agicash/wallet-sdk/temporary';
import { useWriteUserRepository } from './user-repository-hooks';

export function useUserService() {
  const userRepository = useWriteUserRepository();
  return new UserService(userRepository);
}
