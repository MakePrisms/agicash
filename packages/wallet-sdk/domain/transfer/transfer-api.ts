import type { AgicashDb } from '../../db/database';
import { type CashuCryptography, getCashuPrivateKey } from '../../lib/cashu';
import { deriveCashuXpub } from '../../lib/cryptography';
import { NoSessionError, SessionEndedError } from '../../lib/error';
import type { AccountRepository } from '../accounts/account-repository';
import { CashuReceiveQuoteRepository } from '../receive/cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from '../receive/cashu-receive-quote-service';
import { SparkReceiveQuoteRepository } from '../receive/spark-receive-quote-repository';
import { SparkReceiveQuoteService } from '../receive/spark-receive-quote-service';
import type { AuthSession, TransferApi } from '../sdk';
import type { SessionKeys } from '../sdk/session-keys';
import { CashuSendQuoteRepository } from '../send/cashu-send-quote-repository';
import { CashuSendQuoteService } from '../send/cashu-send-quote-service';
import { SparkSendQuoteRepository } from '../send/spark-send-quote-repository';
import { SparkSendQuoteService } from '../send/spark-send-quote-service';
import { TransferService } from './transfer-service';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  /** Required by the CashuReceiveQuoteRepository constructor only. */
  getAccountRepository: () => Promise<AccountRepository>;
  /** Test seam. Default builds `TransferService` from the four services. */
  createService?: () => Promise<TransferService>;
  createCashuReceiveRepository?: () => Promise<CashuReceiveQuoteRepository>;
  createCashuReceiveService?: () => Promise<CashuReceiveQuoteService>;
  createSparkReceiveRepository?: () => Promise<SparkReceiveQuoteRepository>;
  createSparkReceiveService?: () => Promise<SparkReceiveQuoteService>;
  createCashuSendRepository?: () => Promise<CashuSendQuoteRepository>;
  createCashuSendService?: () => Promise<CashuSendQuoteService>;
  createSparkSendRepository?: () => Promise<SparkSendQuoteRepository>;
  createSparkSendService?: () => Promise<SparkSendQuoteService>;
};

/** Creates the `transfer` SDK namespace. */
export function createTransferApi(deps: Deps): TransferApi {
  const requireUserId = (): string => {
    const session = deps.getSession();
    if (!session.isLoggedIn) {
      throw new NoSessionError();
    }
    return session.user.id;
  };

  const cryptography: CashuCryptography = {
    getSeed: () => deps.keys.getCashuSeed(),
    getXpub: async (path) =>
      deriveCashuXpub(await deps.keys.getCashuSeed(), path),
    getPrivateKey: getCashuPrivateKey,
  };

  const getCashuReceiveRepository =
    deps.createCashuReceiveRepository ??
    (async (): Promise<CashuReceiveQuoteRepository> => {
      const encryption = await deps.keys.getEncryption();
      const accountRepository = await deps.getAccountRepository();
      return new CashuReceiveQuoteRepository(
        deps.db,
        encryption,
        accountRepository,
      );
    });
  const getCashuReceiveService =
    deps.createCashuReceiveService ??
    (async (): Promise<CashuReceiveQuoteService> =>
      new CashuReceiveQuoteService(
        cryptography,
        await getCashuReceiveRepository(),
      ));
  const getSparkReceiveRepository =
    deps.createSparkReceiveRepository ??
    (async (): Promise<SparkReceiveQuoteRepository> =>
      new SparkReceiveQuoteRepository(
        deps.db,
        await deps.keys.getEncryption(),
      ));
  const getSparkReceiveService =
    deps.createSparkReceiveService ??
    (async (): Promise<SparkReceiveQuoteService> =>
      new SparkReceiveQuoteService(await getSparkReceiveRepository()));
  const getCashuSendRepository =
    deps.createCashuSendRepository ??
    (async (): Promise<CashuSendQuoteRepository> =>
      new CashuSendQuoteRepository(deps.db, await deps.keys.getEncryption()));
  const getCashuSendService =
    deps.createCashuSendService ??
    (async (): Promise<CashuSendQuoteService> =>
      new CashuSendQuoteService(await getCashuSendRepository()));
  const getSparkSendRepository =
    deps.createSparkSendRepository ??
    (async (): Promise<SparkSendQuoteRepository> =>
      new SparkSendQuoteRepository(deps.db, await deps.keys.getEncryption()));
  const getSparkSendService =
    deps.createSparkSendService ??
    (async (): Promise<SparkSendQuoteService> =>
      new SparkSendQuoteService(await getSparkSendRepository()));
  const getService =
    deps.createService ??
    (async (): Promise<TransferService> =>
      new TransferService(
        await getCashuReceiveService(),
        await getSparkReceiveService(),
        await getCashuSendService(),
        await getSparkSendService(),
      ));

  return {
    getQuote: async (params) => {
      const signal = deps.keys.sessionSignal();
      const service = await getService();
      if (signal.aborted) throw new SessionEndedError();
      const quote = await service.getTransferQuote({
        sourceAccount: params.sourceAccount,
        destinationAccount: params.destinationAccount,
        amount: params.amount,
      });
      if (signal.aborted) throw new SessionEndedError();
      return quote;
    },
    initiate: async (params) => {
      const userId = requireUserId();
      const signal = deps.keys.sessionSignal();
      const service = await getService();
      if (signal.aborted) throw new SessionEndedError();
      const result = await service.initiateTransfer(
        { userId, quote: params.quote },
        { abortSignal: signal },
      );
      if (signal.aborted) throw new SessionEndedError();
      return {
        transferId: result.transferId,
        receiveTransactionId: result.receiveTransactionId,
        sendTransactionId: result.sendTransactionId,
      };
    },
  };
}
