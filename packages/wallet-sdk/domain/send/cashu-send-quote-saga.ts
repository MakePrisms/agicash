import {
  type ExtendedCashuWallet,
  getCashuWallet as defaultGetCashuWallet,
  sumProofs,
} from '@agicash/cashu';
import type { Currency } from '@agicash/money';
import {
  type MeltQuoteBolt11Response,
  MintOperationError,
} from '@cashu/cashu-ts';
import { MeltQuoteSubscriptionManager } from '../../lib/melt-quote-subscription-manager';
import type { Logger } from '../sdk';
import {
  type MeltQuoteInput,
  createMeltQuoteTracker,
} from '../wallet/quote-trackers';
import {
  type SagaStint,
  type TaskSaga,
  runAction,
  startWorkingSet,
} from '../wallet/task-saga';
import type { CashuSendQuote } from './cashu-send-quote';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import type { CashuSendQuoteService } from './cashu-send-quote-service';

export type CashuSendQuoteSagaDeps = {
  getRepository: () => Promise<CashuSendQuoteRepository>;
  getService: () => Promise<CashuSendQuoteService>;
  /** Test seam; defaults to `getCashuWallet` from @agicash/cashu. */
  getCashuWallet?: (mintUrl: string) => ExtendedCashuWallet;
  /** Test seam; defaults to a new manager with the stint logger. */
  createMeltManager?: (logger: Logger) => MeltQuoteSubscriptionManager;
};

const SAGA_NAME = 'cashu-send-quote';

/** Task processing for unresolved cashu send quotes. Runs while this instance leads. */
export function createCashuSendQuoteSaga(
  deps: CashuSendQuoteSagaDeps,
): TaskSaga {
  const getCashuWallet = deps.getCashuWallet ?? defaultGetCashuWallet;
  const createMeltManager =
    deps.createMeltManager ??
    ((logger: Logger) => new MeltQuoteSubscriptionManager(logger));

  return {
    name: SAGA_NAME,
    start(stint) {
      let resetPending = false;
      let syncing = false;
      let syncAgain = false;

      const meltManager = createMeltManager(stint.logger);
      stint.scope.onCleanup(() => {
        meltManager.unsubscribeAll();
      });

      const initiateKeyOf = (quoteId: string) =>
        `initiate-cashu-send-quote-${quoteId}`;
      const keyOf = (quoteId: string) => `cashu-send-quote-${quoteId}`;
      const onGiveUp = (): void => {
        resetPending = true;
      };

      const getWallet = async (
        mintUrl: string,
        currency: Currency,
      ): Promise<ExtendedCashuWallet> =>
        (await stint.accounts.findCashu(mintUrl, currency))?.wallet ??
        getCashuWallet(mintUrl);

      const findByMeltQuoteId = (meltQuoteId: string) =>
        set.find((quote) => quote.quoteId === meltQuoteId);

      const meltTracker = createMeltQuoteTracker(stint, meltManager, {
        getWallet,
        onUnpaid: (meltQuote) => {
          const sendQuote = findByMeltQuoteId(meltQuote.quote);
          // A failed payment flips the melt quote back to UNPAID; only a send
          // that was never initiated is initiated.
          if (sendQuote?.state === 'UNPAID') {
            initiateSend(stint, sendQuote.id, meltQuote);
          }
        },
        onPending: (meltQuote) => {
          const sendQuote = findByMeltQuoteId(meltQuote.quote);
          if (sendQuote) {
            markSendQuoteAsPending(stint, sendQuote.id);
          }
        },
        onExpired: (meltQuote) => {
          const sendQuote = findByMeltQuoteId(meltQuote.quote);
          if (sendQuote) {
            expireSendQuote(stint, sendQuote.id);
          }
        },
        onPaid: (meltQuote) => {
          const sendQuote = findByMeltQuoteId(meltQuote.quote);
          if (sendQuote) {
            completeSendQuote(stint, sendQuote.id, meltQuote);
          }
        },
      });

      const resetIfPending = (): void => {
        if (!resetPending) {
          return;
        }
        resetPending = false;
        meltManager.unsubscribeAll();
        meltTracker.reset();
      };

      stint.onActivated(resetIfPending);
      stint.onReconnected(resetIfPending);

      const set = startWorkingSet<CashuSendQuote>(stint, {
        name: SAGA_NAME,
        keyOf: (quote) => quote.id,
        isPending: (quote) =>
          quote.state === 'UNPAID' || quote.state === 'PENDING',
        load: async (signal) => {
          const repository = await deps.getRepository();
          if (!stint.scope.alive) {
            return [];
          }
          return repository.getUnresolved(stint.userId, {
            abortSignal: signal,
          });
        },
        onChange: () => {
          void runSync();
        },
      });

      async function runSync(): Promise<void> {
        if (!stint.scope.alive) {
          return;
        }
        if (syncing) {
          syncAgain = true;
          return;
        }
        syncing = true;
        try {
          const inputs: MeltQuoteInput[] = [];
          for (const quote of set.values()) {
            const account = await stint.accounts.get(quote.accountId);
            if (!stint.scope.alive) {
              return;
            }
            if (account?.type !== 'cashu') {
              stint.logger.error('Cashu account not found for send quote', {
                sendQuoteId: quote.id,
              });
              continue;
            }
            if (!account.isOnline) {
              continue;
            }
            inputs.push({
              id: quote.quoteId,
              mintUrl: account.mintUrl,
              currency: account.currency,
              expiryInMs: new Date(quote.expiresAt).getTime(),
              inputAmount: sumProofs(quote.proofs),
            });
          }
          meltTracker.sync(inputs);
        } catch (error) {
          stint.logger.warn('Failed to load accounts for task processing', {
            saga: SAGA_NAME,
            cause: error,
          });
        } finally {
          syncing = false;
          if (syncAgain && stint.scope.alive) {
            syncAgain = false;
            void runSync();
          }
        }
      }

      function failSendQuote(
        current: SagaStint,
        quoteId: string,
        reason: string,
      ): void {
        runAction(current, {
          key: undefined,
          retry: 3,
          attempt: async () => {
            const quote = set.get(quoteId);
            if (!quote) {
              return undefined;
            }
            const account = await current.accounts.getCashu(quote.accountId);
            if (!current.scope.alive) {
              return undefined;
            }
            const service = await deps.getService();
            if (!current.scope.alive) {
              return undefined;
            }
            const failed = await service.failSendQuote(account, quote, reason);
            return { failed, mintUrl: account.mintUrl };
          },
          onSuccess: ({ failed, mintUrl }) => {
            // A retry from the confirmation page creates a new send quote for
            // the same melt quote; the subscription must deliver it again.
            meltManager.removeQuoteFromSubscription({
              mintUrl,
              quoteId: failed.quoteId,
            });
            current.emit({
              event: 'cashu-send-quote.updated',
              payload: { quote: failed },
            });
          },
          onError: (error) => {
            current.logger.error('Failed to mark payment as failed', {
              cause: error,
              sendQuoteId: quoteId,
            });
          },
          onGiveUp,
        });
      }

      function initiateSend(
        current: SagaStint,
        quoteId: string,
        meltQuote: MeltQuoteBolt11Response,
      ): void {
        runAction(current, {
          // The melt call can block until the payment settles; PENDING and
          // PAID updates run meanwhile under the other key.
          key: initiateKeyOf(quoteId),
          retry: (failureCount, error) => {
            if (error instanceof MintOperationError) {
              return false;
            }
            return failureCount < 3;
          },
          attempt: async () => {
            const quote = set.get(quoteId);
            if (!quote) {
              return undefined;
            }
            const account = await current.accounts.getCashu(quote.accountId);
            if (!current.scope.alive) {
              return undefined;
            }
            const service = await deps.getService();
            if (!current.scope.alive) {
              return undefined;
            }
            await service.initiateSend(account, quote, meltQuote);
            return true;
          },
          onError: (error) => {
            if (error instanceof MintOperationError) {
              current.logger.warn('Failed to initiate send.', {
                cause: error,
                sendQuoteId: quoteId,
              });
              failSendQuote(current, quoteId, error.message);
            } else {
              current.logger.error('Initiate send error', {
                cause: error,
                sendQuoteId: quoteId,
              });
            }
          },
          onGiveUp,
        });
      }

      function markSendQuoteAsPending(
        current: SagaStint,
        quoteId: string,
      ): void {
        runAction(current, {
          key: keyOf(quoteId),
          retry: 3,
          attempt: async () => {
            const quote = set.get(quoteId);
            if (!quote) {
              return undefined;
            }
            const service = await deps.getService();
            if (!current.scope.alive) {
              return undefined;
            }
            return service.markSendQuoteAsPending(quote);
          },
          onSuccess: (updated) => {
            current.emit({
              event: 'cashu-send-quote.updated',
              payload: { quote: updated },
            });
          },
          onError: (error) => {
            current.logger.error('Mark send quote as pending error', {
              cause: error,
              sendQuoteId: quoteId,
            });
          },
          onGiveUp,
        });
      }

      function expireSendQuote(current: SagaStint, quoteId: string): void {
        runAction(current, {
          key: keyOf(quoteId),
          retry: 3,
          attempt: async () => {
            const quote = set.get(quoteId);
            if (!quote) {
              return undefined;
            }
            const service = await deps.getService();
            if (!current.scope.alive) {
              return undefined;
            }
            await service.expireSendQuote(quote);
            return true;
          },
          onError: (error) => {
            current.logger.error('Expire send quote error', {
              cause: error,
              sendQuoteId: quoteId,
            });
          },
          onGiveUp,
        });
      }

      function completeSendQuote(
        current: SagaStint,
        quoteId: string,
        meltQuote: MeltQuoteBolt11Response,
      ): void {
        runAction(current, {
          key: keyOf(quoteId),
          retry: 3,
          attempt: async () => {
            const quote = set.get(quoteId);
            if (!quote) {
              return undefined;
            }
            const account = await current.accounts.getCashu(quote.accountId);
            if (!current.scope.alive) {
              return undefined;
            }
            const service = await deps.getService();
            if (!current.scope.alive) {
              return undefined;
            }
            return service.completeSendQuote(account, quote, meltQuote);
          },
          onSuccess: (completed) => {
            current.emit({
              event: 'cashu-send-quote.updated',
              payload: { quote: completed },
            });
          },
          onError: (error) => {
            current.logger.error('Complete send quote error', {
              cause: error,
              sendQuoteId: quoteId,
            });
          },
          onGiveUp,
        });
      }

      stint.on('cashu-send-quote.created', ({ quote }) => {
        set.apply(quote);
      });
      stint.on('cashu-send-quote.updated', ({ quote }) => {
        set.apply(quote);
      });
    },
  };
}
