import type { AgicashDb } from '../../db/database';
import { type CashuCryptography, getCashuPrivateKey } from '../../lib/cashu';
import { deriveCashuXpub } from '../../lib/cryptography';
import {
  NoSessionError,
  NotImplementedError,
  SessionEndedError,
} from '../../lib/error';
import type { AccountRepository } from '../accounts/account-repository';
import type { AuthSession, ReceiveApi } from '../sdk';
import type { SessionKeys } from '../sdk/session-keys';
import { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';
import { CashuReceiveSwapService } from './cashu-receive-swap-service';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  /** Accounts bridge; feeds the quote and swap repositories (sdk.ts wires accounts.getRepository). */
  getAccountRepository: () => Promise<AccountRepository>;
  /** Test seam; defaults to building the repository from db + session keys + account repository. */
  createRepository?: () => Promise<CashuReceiveQuoteRepository>;
  /** Test seam; defaults to building the service from session-keys cryptography + the repository. */
  createService?: () => Promise<CashuReceiveQuoteService>;
  /** Test seam; defaults to building the repository from db + session keys + account repository. */
  createSwapRepository?: () => Promise<CashuReceiveSwapRepository>;
  /** Test seam; defaults to building the service from the swap repository. */
  createSwapService?: () => Promise<CashuReceiveSwapService>;
};

/** Creates the `receive` SDK namespace. */
export function createReceiveApi(deps: Deps): ReceiveApi {
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

  const getRepository =
    deps.createRepository ??
    (async (): Promise<CashuReceiveQuoteRepository> => {
      const encryption = await deps.keys.getEncryption();
      const accountRepository = await deps.getAccountRepository();
      return new CashuReceiveQuoteRepository(
        deps.db,
        encryption,
        accountRepository,
      );
    });

  const getService =
    deps.createService ??
    (async (): Promise<CashuReceiveQuoteService> =>
      new CashuReceiveQuoteService(cryptography, await getRepository()));

  const getSwapRepository =
    deps.createSwapRepository ??
    (async (): Promise<CashuReceiveSwapRepository> => {
      const encryption = await deps.keys.getEncryption();
      const accountRepository = await deps.getAccountRepository();
      return new CashuReceiveSwapRepository(
        deps.db,
        encryption,
        accountRepository,
      );
    });

  const getSwapService =
    deps.createSwapService ??
    (async (): Promise<CashuReceiveSwapService> =>
      new CashuReceiveSwapService(await getSwapRepository()));

  return {
    cashu: {
      getLightningQuote: async (params) => {
        const signal = deps.keys.sessionSignal();
        const service = await getService();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await service.getLightningQuote({
          wallet: params.account.wallet,
          amount: params.amount,
          description: params.description,
        });
        if (signal.aborted) throw new SessionEndedError();
        return quote;
      },
      createQuote: async (params) => {
        const userId = requireUserId();
        const signal = deps.keys.sessionSignal();
        const service = await getService();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await service.createReceiveQuote(
          {
            userId,
            account: params.account,
            receiveType: 'LIGHTNING',
            lightningQuote: params.lightningQuote,
            purpose: params.purpose,
            transferId: params.transferId,
          },
          { abortSignal: signal },
        );
        if (signal.aborted) throw new SessionEndedError();
        return quote;
      },
      getQuote: async (id) => {
        const signal = deps.keys.sessionSignal();
        const repository = await getRepository();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await repository.get(id, { abortSignal: signal });
        if (signal.aborted) throw new SessionEndedError();
        return quote;
      },
      // Reversal (reversedTransactionId) stays in-package: only the send-swap
      // reversal (step 14) and the claim orchestration (step 12) pass it.
      createSwap: async (params) => {
        const userId = requireUserId();
        const signal = deps.keys.sessionSignal();
        const service = await getSwapService();
        if (signal.aborted) throw new SessionEndedError();
        const result = await service.create(
          {
            userId,
            token: params.token,
            account: params.account,
          },
          { abortSignal: signal },
        );
        if (signal.aborted) throw new SessionEndedError();
        return result;
      },
    },
    get spark(): ReceiveApi['spark'] {
      throw new NotImplementedError('receive.spark');
    },
    get cashuToken(): ReceiveApi['cashuToken'] {
      throw new NotImplementedError('receive.cashuToken');
    },
  };
}
