import type { BreezSdk, Payment } from '@agicash/breez-sdk-spark';
import {
  type ExtendedCashuWallet,
  getCashuWallet as defaultGetCashuWallet,
  getCashuUnit,
  sumProofs,
} from '@agicash/cashu';
import type { Currency } from '@agicash/money';
import { MintOperationError, NetworkError } from '@cashu/cashu-ts';
import { getInitializedCashuWallet } from '../../lib/cashu';
import { MeltQuoteSubscriptionManager } from '../../lib/melt-quote-subscription-manager';
import { sparkDebugLog } from '../../lib/spark/wallet';
import type { SparkAccount } from '../accounts/account';
import type { Logger } from '../sdk';
import {
  type MeltQuoteInput,
  createMeltQuoteTracker,
} from '../wallet/quote-trackers';
import {
  GIVE_UP_RETRY_MS,
  type SagaStint,
  type TaskSaga,
  runAction,
  startWorkingSet,
} from '../wallet/task-saga';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';
import type { SparkReceiveQuoteService } from './spark-receive-quote-service';

type CashuTokenSparkReceiveQuote = SparkReceiveQuote & { type: 'CASHU_TOKEN' };

export type SparkReceiveQuoteSagaDeps = {
  getRepository: () => Promise<SparkReceiveQuoteRepository>;
  getService: () => Promise<SparkReceiveQuoteService>;
  /** Test seam; defaults to `getInitializedCashuWallet` from lib/cashu. */
  initCashuWallet?: typeof getInitializedCashuWallet;
  /** Test seam; defaults to `getCashuWallet` from @agicash/cashu. */
  getCashuWallet?: (mintUrl: string) => ExtendedCashuWallet;
  /** Test seam; defaults to a new manager with the stint logger. */
  createMeltManager?: (logger: Logger) => MeltQuoteSubscriptionManager;
};

const SAGA_NAME = 'spark-receive-quote';

/** Task processing for pending spark receive quotes. Runs while this instance leads. */
export function createSparkReceiveQuoteSaga(
  deps: SparkReceiveQuoteSagaDeps,
): TaskSaga {
  const initCashuWallet = deps.initCashuWallet ?? getInitializedCashuWallet;
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
      let listeners = new Map<
        string,
        Promise<{ wallet: BreezSdk; listenerId: string } | undefined>
      >();
      const checked = new Set<string>();
      const checking = new Set<string>();
      let checkEpoch = 0;

      const meltManager = createMeltManager(stint.logger);

      const removeListeners = (): void => {
        const registrations = [...listeners.values()];
        listeners = new Map();
        for (const registration of registrations) {
          void registration.then((added) => {
            if (!added) {
              return;
            }
            void added.wallet
              .removeEventListener(added.listenerId)
              .catch(() => {
                stint.logger.warn('Failed to remove Spark event listener', {
                  listenerId: added.listenerId,
                });
              });
          });
        }
      };

      stint.scope.onCleanup(() => {
        meltManager.unsubscribeAll();
        removeListeners();
      });

      const keyOf = (quoteId: string) => `spark-receive-quote-${quoteId}`;
      const onGiveUp = (): void => {
        resetPending = true;
      };

      const getWallet = async (
        mintUrl: string,
        currency: Currency,
      ): Promise<ExtendedCashuWallet> =>
        (await stint.accounts.findCashu(mintUrl, currency))?.wallet ??
        getCashuWallet(mintUrl);

      const findByMeltQuoteId = (
        meltQuoteId: string,
      ): CashuTokenSparkReceiveQuote | undefined =>
        set.find(
          (quote): quote is CashuTokenSparkReceiveQuote =>
            quote.type === 'CASHU_TOKEN' &&
            quote.tokenReceiveData.meltQuoteId === meltQuoteId,
        ) as CashuTokenSparkReceiveQuote | undefined;

      const quotesOf = (accountId: string): SparkReceiveQuote[] =>
        set.values().filter((quote) => quote.accountId === accountId);

      const handlePayment = (accountId: string, payment: Payment): void => {
        const details = payment.details;
        if (details?.type !== 'lightning') {
          return;
        }
        const quote = set.find(
          (q) =>
            q.accountId === accountId &&
            q.paymentHash === details.htlcDetails.paymentHash,
        );
        if (!quote) {
          return;
        }
        const preimage = details.htlcDetails.preimage;
        if (!preimage) {
          stint.logger.error('Receive payment succeeded but no preimage', {
            paymentId: payment.id,
            quoteId: quote.id,
          });
          return;
        }
        sparkDebugLog('Receive payment detected as completed', {
          quoteId: quote.id,
          accountId,
          sparkTransferId: payment.id,
        });
        complete(stint, quote.id, preimage, payment.id);
      };

      const expireIfUnpaid = (
        account: SparkAccount,
        quote: SparkReceiveQuote,
      ): void => {
        stint.scope.track(
          (async () => {
            try {
              const response = await account.wallet.getPaymentByInvoice({
                invoice: quote.paymentRequest,
              });
              if (!stint.scope.alive) {
                return;
              }
              if (response.payment?.status === 'completed') {
                handlePayment(account.id, response.payment);
                return;
              }
            } catch {
              if (!stint.scope.alive) {
                return;
              }
            }
            expire(stint, quote.id);
          })(),
        );
      };

      const addListener = (account: SparkAccount) => {
        const registration = (async () => {
          try {
            const listenerId = await account.wallet.addEventListener({
              onEvent(event) {
                if (!stint.scope.alive) {
                  return;
                }
                if (event.type === 'paymentSucceeded') {
                  handlePayment(account.id, event.payment);
                } else if (event.type === 'synced') {
                  for (const quote of quotesOf(account.id)) {
                    if (new Date(quote.expiresAt).getTime() < stint.now()) {
                      expireIfUnpaid(account, quote);
                    }
                  }
                }
              },
            });
            return { wallet: account.wallet, listenerId };
          } catch (error) {
            if (stint.scope.alive) {
              stint.logger.error('Failed to add Spark event listener', {
                cause: error,
                accountId: account.id,
              });
            }
            return undefined;
          }
        })();
        listeners.set(account.id, registration);
        stint.scope.track(registration);
        return registration;
      };

      const checkInitialPayment = (
        account: SparkAccount,
        quote: SparkReceiveQuote,
      ): void => {
        if (checked.has(quote.id) || checking.has(quote.id)) {
          return;
        }
        checking.add(quote.id);
        const epoch = checkEpoch;
        stint.scope.track(
          (async () => {
            try {
              const response = await account.wallet.getPaymentByInvoice({
                invoice: quote.paymentRequest,
              });
              if (!stint.scope.alive || epoch !== checkEpoch) {
                return;
              }
              checked.add(quote.id);
              if (response.payment?.status === 'completed') {
                handlePayment(account.id, response.payment);
              }
            } catch (error) {
              if (!stint.scope.alive || epoch !== checkEpoch) {
                return;
              }
              stint.logger.error('Error checking initial receive payment', {
                cause: error,
                accountId: account.id,
                quoteId: quote.id,
              });
            } finally {
              if (epoch === checkEpoch) {
                checking.delete(quote.id);
              }
            }
          })(),
        );
      };

      const ensureListener = (account: SparkAccount): void => {
        if (listeners.has(account.id)) {
          return;
        }
        const registration = addListener(account);
        void registration.then((added) => {
          if (!added && listeners.get(account.id) === registration) {
            listeners.delete(account.id);
          }
        });
      };

      const meltTracker = createMeltQuoteTracker(stint, meltManager, {
        getWallet,
        onUnpaid: (meltQuote) => {
          const receiveQuote = findByMeltQuoteId(meltQuote.quote);
          if (!receiveQuote) {
            return;
          }
          if (receiveQuote.tokenReceiveData.meltInitiated) {
            // A melt that was initiated and is UNPAID again has failed.
            fail(stint, receiveQuote.id, 'Cashu token melt failed.');
          } else {
            initiateMelt(stint, receiveQuote.id);
          }
        },
        onPending: (meltQuote) => {
          const receiveQuote = findByMeltQuoteId(meltQuote.quote);
          if (receiveQuote) {
            markMeltInitiated(stint, receiveQuote.id);
          }
        },
        onExpired: (meltQuote) => {
          const receiveQuote = findByMeltQuoteId(meltQuote.quote);
          if (receiveQuote) {
            expire(stint, receiveQuote.id);
          }
        },
      });

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
        meltManager.unsubscribeAll();
        meltTracker.reset();
        removeListeners();
        resetChecks();
        void runSync();
      };

      stint.onActivated(resetChecks);
      stint.onReconnected(resetChecks);
      stint.onActivated(resetIfPending);
      stint.onReconnected(resetIfPending);
      stint.scope.every(GIVE_UP_RETRY_MS, resetIfPending);

      const set = startWorkingSet<SparkReceiveQuote>(stint, {
        name: SAGA_NAME,
        keyOf: (quote) => quote.id,
        isPending: (quote) => quote.state === 'UNPAID',
        load: async (signal) => {
          const repository = await deps.getRepository();
          if (!stint.scope.alive) {
            return [];
          }
          return repository.getPending(stint.userId, { abortSignal: signal });
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
          const online: SparkReceiveQuote[] = [];
          const sparkAccounts = new Map<string, SparkAccount>();
          for (const quote of set.values()) {
            const account = await stint.accounts.get(quote.accountId);
            if (!stint.scope.alive) {
              return;
            }
            if (!account?.isOnline) {
              continue;
            }
            online.push(quote);
            if (account.type === 'spark') {
              sparkAccounts.set(account.id, account);
            }
          }

          meltTracker.sync(
            online
              .filter(
                (quote): quote is CashuTokenSparkReceiveQuote =>
                  quote.type === 'CASHU_TOKEN',
              )
              .map(
                (quote): MeltQuoteInput => ({
                  id: quote.tokenReceiveData.meltQuoteId,
                  mintUrl: quote.tokenReceiveData.sourceMintUrl,
                  currency: quote.tokenReceiveData.tokenAmount.currency,
                  expiryInMs: new Date(quote.expiresAt).getTime(),
                  inputAmount: sumProofs(quote.tokenReceiveData.tokenProofs),
                }),
              ),
          );

          for (const account of sparkAccounts.values()) {
            ensureListener(account);
            for (const quote of online) {
              if (quote.accountId === account.id) {
                checkInitialPayment(account, quote);
              }
            }
          }
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

      function complete(
        current: SagaStint,
        quoteId: string,
        paymentPreimage: string,
        sparkTransferId: string,
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
            return service.complete(quote, paymentPreimage, sparkTransferId);
          },
          onSuccess: (completed) => {
            current.logger.debug('Receive quote completed', {
              quoteId: completed.id,
              accountId: completed.accountId,
              transactionId: completed.transactionId,
            });
            current.emit({
              event: 'spark-receive-quote.updated',
              payload: { quote: completed },
            });
          },
          onError: (error) => {
            current.logger.error('Complete spark receive quote error', {
              cause: error,
              receiveQuoteId: quoteId,
            });
          },
          onGiveUp,
        });
      }

      function expire(current: SagaStint, quoteId: string): void {
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
            await service.expire(quote);
            return true;
          },
          onError: (error) => {
            current.logger.error('Expire spark receive quote error', {
              cause: error,
              receiveQuoteId: quoteId,
            });
          },
          onGiveUp,
        });
      }

      function fail(current: SagaStint, quoteId: string, reason: string): void {
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
            await service.fail(quote, reason);
            return true;
          },
          onError: (error) => {
            current.logger.error('Fail spark receive quote error', {
              cause: error,
              receiveQuoteId: quoteId,
            });
          },
          onGiveUp,
        });
      }

      function initiateMelt(current: SagaStint, quoteId: string): void {
        runAction(current, {
          key: keyOf(quoteId),
          retry: (failureCount, error) => {
            if (error instanceof MintOperationError) {
              return false;
            }
            return failureCount < 3;
          },
          attempt: async () => {
            const quote = set.get(quoteId);
            if (quote?.type !== 'CASHU_TOKEN') {
              return undefined;
            }

            const cashuUnit = getCashuUnit(quote.amount.currency);
            const sourceMintUrl = quote.tokenReceiveData.sourceMintUrl;
            const sourceCurrency = quote.tokenReceiveData.tokenAmount.currency;
            const sourceAccount = await current.accounts.findCashu(
              sourceMintUrl,
              sourceCurrency,
            );
            if (!current.scope.alive) {
              return undefined;
            }

            let sourceWallet: ExtendedCashuWallet;
            if (sourceAccount) {
              sourceWallet = sourceAccount.wallet;
            } else {
              const { wallet, isOnline } = await initCashuWallet({
                mintUrl: sourceMintUrl,
                currency: sourceCurrency,
              });
              if (!current.scope.alive) {
                return undefined;
              }
              if (!isOnline) {
                throw new NetworkError('Source mint is offline');
              }
              sourceWallet = wallet;
            }

            await sourceWallet.meltProofsIdempotent(
              {
                quote: quote.tokenReceiveData.meltQuoteId,
                amount: quote.amount.toNumber(cashuUnit),
              },
              quote.tokenReceiveData.tokenProofs,
              undefined,
              // See claim-cashu-token-service.ts for rationale on random outputs.
              { type: 'random' },
            );
            return true;
          },
          onError: (error) => {
            if (error instanceof MintOperationError) {
              current.logger.warn('Failed to initiate melt.', {
                cause: error,
                receiveQuoteId: quoteId,
              });
              fail(current, quoteId, error.message);
            } else {
              current.logger.error('Initiate melt error', {
                cause: error,
                receiveQuoteId: quoteId,
              });
            }
          },
          onGiveUp,
        });
      }

      function markMeltInitiated(current: SagaStint, quoteId: string): void {
        runAction(current, {
          key: keyOf(quoteId),
          retry: 3,
          attempt: async () => {
            const quote = set.get(quoteId);
            if (quote?.type !== 'CASHU_TOKEN') {
              return undefined;
            }
            const service = await deps.getService();
            if (!current.scope.alive) {
              return undefined;
            }
            return service.markMeltInitiated(quote);
          },
          onSuccess: (updated) => {
            current.emit({
              event: 'spark-receive-quote.updated',
              payload: { quote: updated },
            });
          },
          onError: (error) => {
            current.logger.error('Mark melt initiated error', {
              cause: error,
              receiveQuoteId: quoteId,
            });
          },
          onGiveUp,
        });
      }

      stint.on('spark-receive-quote.created', ({ quote }) => {
        set.apply(quote);
      });
      stint.on('spark-receive-quote.updated', ({ quote }) => {
        set.apply(quote);
      });
    },
  };
}
