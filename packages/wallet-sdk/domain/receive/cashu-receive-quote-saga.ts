import {
  type ExtendedCashuWallet,
  getCashuWallet as defaultGetCashuWallet,
  getCashuUnit,
  sumProofs,
} from '@agicash/cashu';
import type { Currency } from '@agicash/money';
import {
  type MeltQuoteBolt11Response,
  MintOperationError,
  type MintQuoteBolt11Response,
  NetworkError,
} from '@cashu/cashu-ts';
import { getInitializedCashuWallet } from '../../lib/cashu';
import { MeltQuoteSubscriptionManager } from '../../lib/melt-quote-subscription-manager';
import { MintQuoteSubscriptionManager } from '../../lib/mint-quote-subscription-manager';
import type { Logger } from '../sdk';
import {
  type MeltQuoteInput,
  type MintQuoteTrackerOptions,
  createMeltQuoteTracker,
  createMintQuoteTracker,
} from '../wallet/quote-trackers';
import {
  GIVE_UP_RETRY_MS,
  type SagaStint,
  type TaskSaga,
  runAction,
  startWorkingSet,
} from '../wallet/task-saga';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import type { CashuReceiveQuoteService } from './cashu-receive-quote-service';

type CashuTokenReceiveQuote = CashuReceiveQuote & { type: 'CASHU_TOKEN' };

export type CashuReceiveQuoteSagaDeps = {
  getRepository: () => Promise<CashuReceiveQuoteRepository>;
  getService: () => Promise<CashuReceiveQuoteService>;
  /** Test seam; defaults to `getInitializedCashuWallet` from lib/cashu. */
  initCashuWallet?: typeof getInitializedCashuWallet;
  /** Test seam; defaults to `getCashuWallet` from @agicash/cashu. */
  getCashuWallet?: (mintUrl: string) => ExtendedCashuWallet;
  /** Test seam; defaults to new managers with the stint logger. */
  createMintManager?: (logger: Logger) => MintQuoteSubscriptionManager;
  /** Test seam; defaults to new managers with the stint logger. */
  createMeltManager?: (logger: Logger) => MeltQuoteSubscriptionManager;
  /** Test seam; passed to the mint quote tracker. */
  mintTrackerOptions?: MintQuoteTrackerOptions;
};

const SAGA_NAME = 'cashu-receive-quote';

/** Task processing for pending cashu receive quotes. Runs while this instance leads. */
export function createCashuReceiveQuoteSaga(
  deps: CashuReceiveQuoteSagaDeps,
): TaskSaga {
  const initCashuWallet = deps.initCashuWallet ?? getInitializedCashuWallet;
  const getCashuWallet = deps.getCashuWallet ?? defaultGetCashuWallet;
  const createMintManager =
    deps.createMintManager ??
    ((logger: Logger) => new MintQuoteSubscriptionManager(logger));
  const createMeltManager =
    deps.createMeltManager ??
    ((logger: Logger) => new MeltQuoteSubscriptionManager(logger));

  return {
    name: SAGA_NAME,
    start(stint) {
      let resetPending = false;
      let syncing = false;
      let syncAgain = false;

      const mintManager = createMintManager(stint.logger);
      const meltManager = createMeltManager(stint.logger);
      stint.scope.onCleanup(() => {
        mintManager.unsubscribeAll();
        meltManager.unsubscribeAll();
      });

      const keyOf = (quoteId: string) => `cashu-receive-quote-${quoteId}`;
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
      ): CashuTokenReceiveQuote | undefined =>
        set.find(
          (quote): quote is CashuTokenReceiveQuote =>
            quote.type === 'CASHU_TOKEN' &&
            quote.tokenReceiveData.meltQuoteId === meltQuoteId,
        ) as CashuTokenReceiveQuote | undefined;

      const processMintQuote = (mintQuote: MintQuoteBolt11Response): void => {
        const receiveQuote = set.find(
          (quote) => quote.quoteId === mintQuote.quote,
        );
        if (!receiveQuote) {
          stint.logger.warn(
            'No related receive quote found for the mint quote',
          );
          return;
        }

        stint.logger.debug(`Mint quote state changed: ${mintQuote.state}`, {
          receiveQuoteId: receiveQuote.id,
          unit: mintQuote.unit,
        });

        const expiresAt = new Date(receiveQuote.expiresAt).getTime();
        if (mintQuote.state === 'UNPAID' && expiresAt < stint.now()) {
          expire(stint, receiveQuote.id);
        } else if (mintQuote.state === 'PAID') {
          complete(stint, receiveQuote.id);
        } else if (mintQuote.state === 'ISSUED') {
          // A complete that minted the proofs but failed to mark the quote
          // COMPLETED leaves the mint quote ISSUED; completing again finishes it.
          complete(stint, receiveQuote.id);
        }
      };

      const mintTracker = createMintQuoteTracker(
        stint,
        mintManager,
        {
          getAccount: async (quoteId) => {
            const quote = set.get(quoteId);
            if (!quote) {
              return undefined;
            }
            const account = await stint.accounts.get(quote.accountId);
            return account?.type === 'cashu' ? account : undefined;
          },
          onUpdate: processMintQuote,
          onGiveUp,
        },
        deps.mintTrackerOptions,
      );

      const meltTracker = createMeltQuoteTracker(stint, meltManager, {
        getWallet,
        onUnpaid: (meltQuote: MeltQuoteBolt11Response) => {
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
          if (!receiveQuote) {
            return;
          }
          markMeltInitiated(stint, receiveQuote.id);
        },
        onExpired: (meltQuote) => {
          const receiveQuote = findByMeltQuoteId(meltQuote.quote);
          if (!receiveQuote) {
            return;
          }
          expire(stint, receiveQuote.id);
        },
        onGiveUp,
      });

      const reset = (): void => {
        mintManager.unsubscribeAll();
        meltManager.unsubscribeAll();
        mintTracker.reset();
        meltTracker.reset();
      };

      const resetIfPending = (): void => {
        if (!resetPending) {
          return;
        }
        resetPending = false;
        reset();
        void runSync();
      };

      stint.onActivated(resetIfPending);
      stint.onReconnected(resetIfPending);
      stint.scope.every(GIVE_UP_RETRY_MS, resetIfPending);

      const set = startWorkingSet<CashuReceiveQuote>(stint, {
        name: SAGA_NAME,
        keyOf: (quote) => quote.id,
        isPending: (quote) =>
          quote.state === 'UNPAID' || quote.state === 'PAID',
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
          const online: CashuReceiveQuote[] = [];
          for (const quote of set.values()) {
            const account = await stint.accounts.get(quote.accountId);
            if (!stint.scope.alive) {
              return;
            }
            if (account?.isOnline) {
              online.push(quote);
            }
          }

          await mintTracker.sync(online);
          if (!stint.scope.alive) {
            return;
          }

          meltTracker.sync(
            online
              .filter(
                (quote): quote is CashuTokenReceiveQuote =>
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

      function complete(current: SagaStint, quoteId: string): void {
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
            return service.completeReceive(account, quote);
          },
          onSuccess: (result) => {
            current.emit({
              event: 'cashu-receive-quote.updated',
              payload: { quote: result.quote },
            });
          },
          onError: (error) => {
            current.logger.error('Complete cashu receive quote error', {
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
            current.logger.error('Expire cashu receive quote error', {
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
            current.logger.error('Fail cashu receive quote error', {
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
              event: 'cashu-receive-quote.updated',
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

      stint.on('cashu-receive-quote.created', ({ quote }) => {
        set.apply(quote);
      });
      stint.on('cashu-receive-quote.updated', ({ quote }) => {
        set.apply(quote);
      });
    },
  };
}
