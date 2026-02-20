export { UserService } from '@agicash/core/features/user/user-service';
import { UserService } from '@agicash/core/features/user/user-service';
import { useWriteUserRepository } from './user-repository';

export function useUserService() {
  const userRepository = useWriteUserRepository();
  return new UserService(userRepository);
}
