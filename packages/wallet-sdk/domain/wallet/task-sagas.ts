import type { AgicashDb } from '../../db/database';
import type { AccountRepository } from '../accounts/account-repository';
import { CashuReceiveSwapRepository } from '../receive/cashu-receive-swap-repository';
import { createCashuReceiveSwapSaga } from '../receive/cashu-receive-swap-saga';
import { CashuReceiveSwapService } from '../receive/cashu-receive-swap-service';
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
export function createTaskSagas(deps: TaskSagasDeps): TaskSaga[] {
  const getRepository = async (): Promise<CashuReceiveSwapRepository> => {
    const encryption = await deps.keys.getEncryption();
    const accountRepository = await deps.getAccountRepository();
    return new CashuReceiveSwapRepository(
      deps.db,
      encryption,
      accountRepository,
    );
  };

  const getService = async (): Promise<CashuReceiveSwapService> =>
    new CashuReceiveSwapService(await getRepository());

  return [
    createCashuReceiveSwapSaga({
      getRepository,
      getService,
    }),
  ];
}
