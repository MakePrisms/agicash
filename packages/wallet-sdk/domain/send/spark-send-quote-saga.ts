import type { Payment } from '@agicash/breez-sdk-spark';
import { DomainError } from '../../lib/error';
import { sparkDebugLog } from '../../lib/spark/wallet';
import type { SparkAccount } from '../accounts/account';
import {
  GIVE_UP_RETRY_MS,
  type SagaStint,
  type TaskSaga,
  runAction,
  startWorkingSet,
} from '../wallet/task-saga';
import type { SparkSendQuote } from './spark-send-quote';
import type { SparkSendQuoteRepository } from './spark-send-quote-repository';
import type { SparkSendQuoteService } from './spark-send-quote-service';

export type SparkSendQuoteSagaDeps = {
  getRepository: () => Promise<SparkSendQuoteRepository>;
  getService: () => Promise<SparkSendQuoteService>;
};

type PendingSparkSendQuote = SparkSendQuote & {
  state: 'PENDING';
  sparkTransferId: string;
};

function isPendingQuote(quote: SparkSendQuote): quote is PendingSparkSendQuote {
  return quote.state === 'PENDING';
}

type TrackedListener = {
  listenerId: string;
  remove: () => Promise<boolean>;
};

/** Task processing for unresolved spark send quotes. Runs while this instance leads. */
export function createSparkSendQuoteSaga(
  deps: SparkSendQuoteSagaDeps,
): TaskSaga {
  return {
    name: 'spark-send-quote',
    start(stint) {
      let resetPending = false;
      const lastTriggered = new Map<string, SparkSendQuote['state']>();
      const checked = new Set<string>();
      const checking = new Set<string>();
      let checkEpoch = 0;
      let listenerEpoch = 0;
      let syncing = false;
      let syncAgain = false;
      const listeners = new Map<string, TrackedListener>();
      const listenerInflight = new Map<string, Promise<void>>();

      const removeListeners = (): void => {
        listenerEpoch += 1;
        for (const listener of listeners.values()) {
          void listener.remove().catch(() => {
            stint.logger.warn('Failed to remove Spark event listener', {
              listenerId: listener.listenerId,
            });
          });
        }
        listeners.clear();
        listenerInflight.clear();
      };

      const resetChecks = (): void => {
        checked.clear();
        checking.clear();
        checkEpoch += 1;
      };

      const resetIfPending = (): void => {
        if (!resetPending) {
          return;
        }
        resetPending = false;
        lastTriggered.clear();
        resetChecks();
        removeListeners();
        void runSync();
      };

      stint.onActivated(resetChecks);
      stint.onReconnected(resetChecks);
      stint.onActivated(resetIfPending);
      stint.onReconnected(resetIfPending);
      stint.scope.every(GIVE_UP_RETRY_MS, resetIfPending);
      stint.scope.onCleanup(() => {
        removeListeners();
      });

      const set = startWorkingSet<SparkSendQuote>(stint, {
        name: 'spark-send-quote',
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

      function handlePayment(
        payment: Payment,
        eventType: 'paymentSucceeded' | 'paymentFailed',
      ): void {
        if (!stint.scope.alive) {
          return;
        }
        const quote = set.find(
          (item): item is PendingSparkSendQuote =>
            isPendingQuote(item) && item.sparkTransferId === payment.id,
        );
        if (!quote) {
          return;
        }
        if (eventType === 'paymentSucceeded') {
          if (lastTriggered.get(quote.id) === 'COMPLETED') {
            return;
          }
          const preimage =
            payment.details?.type === 'lightning'
              ? payment.details.htlcDetails.preimage
              : undefined;
          if (!preimage) {
            stint.logger.error('Payment succeeded but no preimage', {
              paymentId: payment.id,
            });
            return;
          }
          lastTriggered.set(quote.id, 'COMPLETED');
          sparkDebugLog('Send payment detected as completed', {
            quoteId: quote.id,
            accountId: quote.accountId,
          });
          startComplete(stint, quote.id, preimage);
          return;
        }
        if (lastTriggered.get(quote.id) === 'FAILED') {
          return;
        }
        lastTriggered.set(quote.id, 'FAILED');
        const message =
          quote.expiresAt && new Date(quote.expiresAt) < new Date()
            ? 'Lightning invoice expired.'
            : 'Lightning payment failed.';
        startFail(stint, quote.id, message);
      }

      async function addListener(account: SparkAccount): Promise<void> {
        const epoch = listenerEpoch;
        const wallet = account.wallet;
        try {
          const listenerId = await wallet.addEventListener({
            onEvent(event) {
              if (!stint.scope.alive) {
                return;
              }
              if (event.type === 'paymentSucceeded') {
                handlePayment(event.payment, 'paymentSucceeded');
              } else if (event.type === 'paymentFailed') {
                handlePayment(event.payment, 'paymentFailed');
              }
            },
          });
          if (!stint.scope.alive || epoch !== listenerEpoch) {
            void wallet.removeEventListener(listenerId).catch(() => {
              stint.logger.warn('Failed to remove Spark event listener', {
                listenerId,
              });
            });
            return;
          }
          listeners.set(account.id, {
            listenerId,
            remove: () => wallet.removeEventListener(listenerId),
          });
        } catch (error) {
          if (stint.scope.alive) {
            stint.logger.error('Failed to add Spark event listener', {
              cause: error,
              accountId: account.id,
            });
          }
        }
      }

      function ensureListener(account: SparkAccount): void {
        if (listeners.has(account.id) || listenerInflight.has(account.id)) {
          return;
        }
        const run = addListener(account);
        listenerInflight.set(account.id, run);
        stint.scope.track(run);
        void run.then(() => {
          if (listenerInflight.get(account.id) === run) {
            listenerInflight.delete(account.id);
          }
        });
      }

      function startInitialCheck(
        account: SparkAccount,
        quote: PendingSparkSendQuote,
      ): void {
        if (checked.has(quote.id) || checking.has(quote.id)) {
          return;
        }
        checking.add(quote.id);
        const epoch = checkEpoch;
        const sparkTransferId = quote.sparkTransferId;
        const quoteId = quote.id;
        const run = (async () => {
          try {
            const { payment } = await account.wallet.getPayment({
              paymentId: sparkTransferId,
            });
            if (!stint.scope.alive || epoch !== checkEpoch) {
              return;
            }
            checked.add(quoteId);
            if (payment.status === 'completed') {
              handlePayment(payment, 'paymentSucceeded');
            } else if (payment.status === 'failed') {
              handlePayment(payment, 'paymentFailed');
            }
          } catch (error) {
            if (!stint.scope.alive || epoch !== checkEpoch) {
              return;
            }
            stint.logger.error('Error checking initial send payment status', {
              cause: error,
              sparkTransferId,
            });
          } finally {
            if (epoch === checkEpoch) {
              checking.delete(quoteId);
            }
          }
        })();
        stint.scope.track(run);
      }

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
          const quotes = set.values();
          const activeIds = new Set<string>();
          const pendingByAccount = new Map<string, PendingSparkSendQuote[]>();
          for (const quote of quotes) {
            if (!stint.scope.alive) {
              return;
            }
            const account = await stint.accounts.get(quote.accountId);
            if (!stint.scope.alive) {
              return;
            }
            if (!account?.isOnline || account.type !== 'spark') {
              continue;
            }
            const current = set.get(quote.id);
            if (!current) {
              continue;
            }
            activeIds.add(current.id);
            if (current.state === 'UNPAID') {
              if (lastTriggered.get(current.id) !== 'UNPAID') {
                lastTriggered.set(current.id, 'UNPAID');
                startInitiate(stint, current.id);
              }
              continue;
            }
            if (isPendingQuote(current)) {
              const group = pendingByAccount.get(current.accountId) ?? [];
              group.push(current);
              pendingByAccount.set(current.accountId, group);
            }
          }
          if (!stint.scope.alive) {
            return;
          }
          for (const key of [...lastTriggered.keys()]) {
            if (!activeIds.has(key)) {
              lastTriggered.delete(key);
            }
          }
          for (const [accountId, pendingQuotes] of pendingByAccount) {
            if (!stint.scope.alive) {
              return;
            }
            const account = await stint.accounts.getSpark(accountId);
            if (!stint.scope.alive) {
              return;
            }
            ensureListener(account);
            for (const quote of pendingQuotes) {
              const current = set.get(quote.id);
              if (!current || !isPendingQuote(current)) {
                continue;
              }
              startInitialCheck(account, current);
            }
          }
        } catch (error) {
          stint.logger.warn('Failed to load accounts for task processing', {
            saga: 'spark-send-quote',
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

      function startInitiate(current: SagaStint, quoteId: string): void {
        runAction(current, {
          key: `spark-send-quote-${quoteId}`,
          retry: 3,
          attempt: async () => {
            const quote = set.get(quoteId);
            if (quote?.state !== 'UNPAID') {
              return undefined;
            }
            const account = await current.accounts.getSpark(quote.accountId);
            if (!current.scope.alive) {
              return undefined;
            }
            const service = await deps.getService();
            if (!current.scope.alive) {
              return undefined;
            }
            try {
              return await service.initiateSend({
                account,
                sendQuote: quote,
              });
            } catch (error) {
              if (error instanceof DomainError) {
                if (!current.scope.alive) {
                  return undefined;
                }
                startFail(current, quoteId, error.message);
                return undefined;
              }
              throw error;
            }
          },
          onSuccess: (result) => {
            current.emit({
              event: 'spark-send-quote.updated',
              payload: { quote: result },
            });
          },
          onError: (error) => {
            current.logger.error('Initiate spark send quote error', {
              cause: error,
              sendQuoteId: quoteId,
            });
          },
          onGiveUp: () => {
            resetPending = true;
          },
        });
      }

      function startComplete(
        current: SagaStint,
        quoteId: string,
        preimage: string,
      ): void {
        runAction(current, {
          key: `spark-send-quote-${quoteId}`,
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
            return service.complete(quote, preimage);
          },
          onSuccess: (result) => {
            current.logger.debug('Send quote completed', {
              quoteId: result.id,
              accountId: result.accountId,
            });
            current.emit({
              event: 'spark-send-quote.updated',
              payload: { quote: result },
            });
          },
          onError: (error) => {
            current.logger.error('Complete spark send quote error', {
              cause: error,
              sendQuoteId: quoteId,
            });
          },
          onGiveUp: () => {
            resetPending = true;
          },
        });
      }

      function startFail(
        current: SagaStint,
        quoteId: string,
        reason: string,
      ): void {
        runAction(current, {
          key: `spark-send-quote-${quoteId}`,
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
            return service.fail(quote, reason);
          },
          onSuccess: (result) => {
            current.emit({
              event: 'spark-send-quote.updated',
              payload: { quote: result },
            });
          },
          onError: (error) => {
            current.logger.error('Failed to mark spark send quote as failed', {
              cause: error,
              sendQuoteId: quoteId,
            });
          },
          onGiveUp: () => {
            resetPending = true;
          },
        });
      }

      stint.on('spark-send-quote.created', ({ quote }) => {
        set.apply(quote);
      });
      stint.on('spark-send-quote.updated', ({ quote }) => {
        set.apply(quote);
      });
    },
  };
}
