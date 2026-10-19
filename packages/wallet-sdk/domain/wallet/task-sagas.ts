import type { AgicashDb } from '../../db/database';
import { type CashuCryptography, getCashuPrivateKey } from '../../lib/cashu';
import { deriveCashuXpub } from '../../lib/cryptography';
import type { AccountRepository } from '../accounts/account-repository';
import { CashuReceiveQuoteRepository } from '../receive/cashu-receive-quote-repository';
import { createCashuReceiveQuoteSaga } from '../receive/cashu-receive-quote-saga';
import { CashuReceiveQuoteService } from '../receive/cashu-receive-quote-service';
import { CashuReceiveSwapRepository } from '../receive/cashu-receive-swap-repository';
import { createCashuReceiveSwapSaga } from '../receive/cashu-receive-swap-saga';
import { CashuReceiveSwapService } from '../receive/cashu-receive-swap-service';
import type { SessionKeys } from '../sdk/session-keys';
import { CashuSendSwapRepository } from '../send/cashu-send-swap-repository';
import { createCashuSendSwapSaga } from '../send/cashu-send-swap-saga';
import { CashuSendSwapService } from '../send/cashu-send-swap-service';
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
  const cryptography: CashuCryptography = {
    getSeed: () => deps.keys.getCashuSeed(),
    getXpub: async (path) =>
      deriveCashuXpub(await deps.keys.getCashuSeed(), path),
    getPrivateKey: getCashuPrivateKey,
  };

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

  const getSendSwapRepository = async (): Promise<CashuSendSwapRepository> =>
    new CashuSendSwapRepository(deps.db, await deps.keys.getEncryption());

  const getSendSwapService = async (): Promise<CashuSendSwapService> =>
    new CashuSendSwapService(await getSendSwapRepository(), await getService());

  const getReceiveQuoteRepository =
    async (): Promise<CashuReceiveQuoteRepository> => {
      const encryption = await deps.keys.getEncryption();
      const accountRepository = await deps.getAccountRepository();
      return new CashuReceiveQuoteRepository(
        deps.db,
        encryption,
        accountRepository,
      );
    };

  const getReceiveQuoteService = async (): Promise<CashuReceiveQuoteService> =>
    new CashuReceiveQuoteService(
      cryptography,
      await getReceiveQuoteRepository(),
    );

  return [
    createCashuReceiveSwapSaga({
      getRepository,
      getService,
    }),
    createCashuSendSwapSaga({
      getRepository: getSendSwapRepository,
      getService: getSendSwapService,
    }),
    createCashuReceiveQuoteSaga({
      getRepository: getReceiveQuoteRepository,
      getService: getReceiveQuoteService,
    }),
  ];
}
