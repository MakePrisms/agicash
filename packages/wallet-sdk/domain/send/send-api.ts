import type { AgicashDb } from '../../db/database';
import {
  NoSessionError,
  NotImplementedError,
  SessionEndedError,
} from '../../lib/error';
import type { AuthSession, SendApi } from '../sdk';
import type { SessionKeys } from '../sdk/session-keys';
import { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import { CashuSendQuoteService } from './cashu-send-quote-service';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  /** Test seam; defaults to building the repository from db + session-keys encryption. */
  createRepository?: () => Promise<CashuSendQuoteRepository>;
  /** Test seam; defaults to building the service from the repository. */
  createService?: () => Promise<CashuSendQuoteService>;
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
      get getSwapQuote(): SendApi['cashu']['getSwapQuote'] {
        throw new NotImplementedError('send.cashu.getSwapQuote');
      },
      get createSwap(): SendApi['cashu']['createSwap'] {
        throw new NotImplementedError('send.cashu.createSwap');
      },
    },
    get spark(): SendApi['spark'] {
      throw new NotImplementedError('send.spark');
    },
  };
}
