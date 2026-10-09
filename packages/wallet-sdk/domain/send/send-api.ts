import type { Money } from '@agicash/money';
import type { AgicashDb } from '../../db/database';
import {
  NoSessionError,
  NotImplementedError,
  SessionEndedError,
} from '../../lib/error';
import type { AccountRepository } from '../accounts/account-repository';
import { CashuReceiveSwapRepository } from '../receive/cashu-receive-swap-repository';
import { CashuReceiveSwapService } from '../receive/cashu-receive-swap-service';
import type { AuthSession, SendApi } from '../sdk';
import type { SessionKeys } from '../sdk/session-keys';
import { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import { CashuSendQuoteService } from './cashu-send-quote-service';
import { CashuSendSwapRepository } from './cashu-send-swap-repository';
import { CashuSendSwapService } from './cashu-send-swap-service';
import { SparkSendQuoteRepository } from './spark-send-quote-repository';
import { SparkSendQuoteService } from './spark-send-quote-service';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  /** Test seam; defaults to building the repository from db + session-keys encryption. */
  createRepository?: () => Promise<CashuSendQuoteRepository>;
  /** Test seam; defaults to building the service from the repository. */
  createService?: () => Promise<CashuSendQuoteService>;
  /** Accounts bridge; feeds the receive-swap repository the send-swap service constructor requires. */
  getAccountRepository: () => Promise<AccountRepository>;
  /** Test seam; defaults to building the swap repository from db + session-keys encryption. */
  createSwapRepository?: () => Promise<CashuSendSwapRepository>;
  /** Test seam; defaults to building the swap service from the swap repository + a receive-swap service. */
  createSwapService?: () => Promise<CashuSendSwapService>;
  /** Test seam; defaults to building the spark repository from db + session-keys encryption. */
  createSparkRepository?: () => Promise<SparkSendQuoteRepository>;
  /** Test seam; defaults to building the spark service from the spark repository. */
  createSparkService?: () => Promise<SparkSendQuoteService>;
};

/** Creates the `send` SDK namespace. */
export function createSendApi(deps: Deps): SendApi {
  const requireUserId = (): string => {
    const session = deps.getSession();
    if (!session.isLoggedIn) {
      throw new NoSessionError();
    }
    return session.user.id;
  };

  const getRepository =
    deps.createRepository ??
    (async (): Promise<CashuSendQuoteRepository> =>
      new CashuSendQuoteRepository(deps.db, await deps.keys.getEncryption()));

  const getService =
    deps.createService ??
    (async (): Promise<CashuSendQuoteService> =>
      new CashuSendQuoteService(await getRepository()));

  const getSwapRepository =
    deps.createSwapRepository ??
    (async (): Promise<CashuSendSwapRepository> =>
      new CashuSendSwapRepository(deps.db, await deps.keys.getEncryption()));

  const getReceiveSwapService = async (): Promise<CashuReceiveSwapService> => {
    const encryption = await deps.keys.getEncryption();
    const accountRepository = await deps.getAccountRepository();
    return new CashuReceiveSwapService(
      new CashuReceiveSwapRepository(deps.db, encryption, accountRepository),
    );
  };

  const getSwapService =
    deps.createSwapService ??
    (async (): Promise<CashuSendSwapService> =>
      new CashuSendSwapService(
        await getSwapRepository(),
        await getReceiveSwapService(),
      ));

  const getSparkRepository =
    deps.createSparkRepository ??
    (async (): Promise<SparkSendQuoteRepository> =>
      new SparkSendQuoteRepository(deps.db, await deps.keys.getEncryption()));

  const getSparkService =
    deps.createSparkService ??
    (async (): Promise<SparkSendQuoteService> =>
      new SparkSendQuoteService(await getSparkRepository()));

  return {
    get resolveDestination(): SendApi['resolveDestination'] {
      throw new NotImplementedError('send.resolveDestination');
    },
    cashu: {
      getLightningQuote: async (params) => {
        const signal = deps.keys.sessionSignal();
        const service = await getService();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await service.getLightningQuote({
          account: params.account,
          paymentRequest: params.paymentRequest,
          amount: params.amount,
        });
        if (signal.aborted) throw new SessionEndedError();
        return quote;
      },
      createQuote: async (params) => {
        const userId = requireUserId();
        const signal = deps.keys.sessionSignal();
        const service = await getService();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await service.createSendQuote(
          {
            userId,
            account: params.account,
            sendQuote: params.lightningQuote,
            destinationDetails: params.destinationDetails,
          },
          { abortSignal: signal },
        );
        if (signal.aborted) throw new SessionEndedError();
        return { transactionId: quote.transactionId };
      },
      getSwapQuote: async (params) => {
        const signal = deps.keys.sessionSignal();
        const service = await getSwapService();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await service.getQuote({
          account: params.account,
          amount: params.amount,
          senderPaysFee: true,
        });
        if (signal.aborted) throw new SessionEndedError();
        return quote;
      },
      createSwap: async (params) => {
        const userId = requireUserId();
        const signal = deps.keys.sessionSignal();
        const service = await getSwapService();
        if (signal.aborted) throw new SessionEndedError();
        const swap = await service.create(
          {
            userId,
            account: params.account,
            amount: params.amount,
            senderPaysFee: true,
          },
          { abortSignal: signal },
        );
        if (signal.aborted) throw new SessionEndedError();
        return { swap };
      },
    },
    spark: {
      getLightningQuote: async (params) => {
        const signal = deps.keys.sessionSignal();
        const service = await getSparkService();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await service.getLightningSendQuote({
          account: params.account,
          paymentRequest: params.paymentRequest,
          amount: params.amount as Money<'BTC'> | undefined,
        });
        if (signal.aborted) throw new SessionEndedError();
        return quote;
      },
      createQuote: async (params) => {
        const userId = requireUserId();
        const signal = deps.keys.sessionSignal();
        const service = await getSparkService();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await service.createSendQuote(
          {
            userId,
            account: params.account,
            quote: params.lightningQuote,
          },
          { abortSignal: signal },
        );
        if (signal.aborted) throw new SessionEndedError();
        return { transactionId: quote.transactionId };
      },
    },
  };
}
