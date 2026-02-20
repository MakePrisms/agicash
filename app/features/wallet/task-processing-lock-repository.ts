export { TaskProcessingLockRepository } from '@agicash/core/features/wallet/task-processing-lock-repository';
import { TaskProcessingLockRepository } from '@agicash/core/features/wallet/task-processing-lock-repository';
import { agicashDbClient } from '../agicash-db/database.client';

export function useTaskProcessingLockRepository() {
  return new TaskProcessingLockRepository(agicashDbClient);
}
