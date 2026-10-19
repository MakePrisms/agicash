import type { AgicashDb } from '../../db/database';
import type { AccountRepository } from '../accounts/account-repository';
import type { SessionKeys } from '../sdk/session-keys';
import type { TaskSaga } from './task-saga';

export type TaskSagasDeps = {
  db: AgicashDb;
  keys: SessionKeys;
  getAccountRepository: () => Promise<AccountRepository>;
};

/**
 * The task-processing flows, in start order. SDK-internal: never exported from the package.
 */
export function createTaskSagas(_deps: TaskSagasDeps): TaskSaga[] {
  return [];
}
