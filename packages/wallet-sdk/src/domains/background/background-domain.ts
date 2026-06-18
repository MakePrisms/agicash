import type { BackgroundDomain } from '../../domains';
import { SdkError } from '../../errors';
import { TaskLoop } from '../../internal/background/task-loop';
import { TaskProcessingLockRepository } from '../../internal/background/task-processing-lock-repository';
import { BackgroundRunner } from '../../internal/background/background-runner';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import { toUser } from '../../internal/db/user-mapper';
import {
  type ExtendedCashuWallet,
  areMintUrlsEqual,
  getCashuUnit,
} from '../../internal/lib/cashu';
import { MeltQuoteSubscriptionManager } from '../../internal/lib/cashu/melt-quote-subscription-manager';
import { MintQuoteSubscriptionManager } from '../../internal/lib/cashu/mint-quote-subscription-manager';
import { ProofStateSubscriptionManager } from '../../internal/lib/cashu/proof-state-subscription-manager';
import { CashuReceiveQuoteOrchestrator } from '../../internal/orchestrator/cashu-receive-quote-orchestrator';
import { CashuReceiveSwapOrchestrator } from '../../internal/orchestrator/cashu-receive-swap-orchestrator';
import { CashuSendOrchestrator } from '../../internal/orchestrator/cashu-send-orchestrator';
import { CashuSendSwapOrchestrator } from '../../internal/orchestrator/cashu-send-swap-orchestrator';
import { SparkBalanceListener } from '../../internal/orchestrator/spark-balance-listener';
import { SparkReceiveOrchestrator } from '../../internal/orchestrator/spark-receive-orchestrator';
import { SparkSendOrchestrator } from '../../internal/orchestrator/spark-send-orchestrator';
import { WalletChangesForwarder } from '../../internal/realtime/wallet-changes-forwarder';
import type { AccountRepository } from '../../internal/repositories/account-repository';
import { CashuReceiveQuoteRepository } from '../../internal/repositories/cashu-receive-quote-repository';
import { CashuReceiveSwapRepository } from '../../internal/repositories/cashu-receive-swap-repository';
import { CashuSendQuoteRepository } from '../../internal/repositories/cashu-send-quote-repository';
import { CashuSendSwapRepository } from '../../internal/repositories/cashu-send-swap-repository';
import { SparkReceiveQuoteRepository } from '../../internal/repositories/spark-receive-quote-repository';
import { SparkSendQuoteRepository } from '../../internal/repositories/spark-send-quote-repository';
import { TransactionRepository } from '../../internal/repositories/transaction-repository';
import type { CashuAccount, SparkAccount } from '../../types/account';
import type { CashuTokenMeltData } from '../../types/cashu';
import { CashuReceiveQuoteService } from '../cashu/cashu-receive-quote-service';
import { CashuReceiveSwapService } from '../cashu/cashu-receive-swap-service';
import { CashuSendQuoteService } from '../cashu/cashu-send-quote-service';
import { CashuSendSwapService } from '../cashu/cashu-send-swap-service';
import type { DomainContext } from '../context';
import { SparkReceiveQuoteService } from '../spark/spark-receive-quote-service';
import { SparkSendQuoteService } from '../spark/spark-send-quote-service';

/**
 * Build the background-processing domain: the whole orchestration bundle (six
 * repos + six services + five WS managers + six orchestrators + the spark balance
 * listener + the shared account/wallet/melt helpers), the realtime
 * {@link WalletChangesForwarder}, the {@link TaskProcessingLockRepository}, the
 * {@link TaskLoop}, and the leader {@link BackgroundRunner}. `start`/`stop`/`state`
 * delegate to the runner.
 *
 * Per the web's separate-per-processor pattern, each cashu orchestrator gets its
 * OWN subscription-manager instance (cashu-send melt, cashu-receive mint,
 * cashu-receive melt, send-swap proof-state, spark-receive melt).
 */
export function createBackgroundDomain(
  ctx: DomainContext,
  accountRepository: AccountRepository,
): BackgroundDomain {
  const { config, connections, emitter } = ctx;
  const { supabase, encryption, cashuCrypto, realtime } = connections;

  const getUserId = () => getCurrentUserId(config.storage);

  // Account / wallet resolution — online-filtered (offline spark accounts hold a
  // throwing stub wallet, so they are excluded here too).
  const getCashuAccount = async (id: string): Promise<CashuAccount | null> => {
    const account = await accountRepository.get(id);
    return account && account.type === 'cashu' && account.isOnline
      ? account
      : null;
  };
  const getSparkAccount = async (id: string): Promise<SparkAccount | null> => {
    const account = await accountRepository.get(id);
    return account && account.type === 'spark' && account.isOnline
      ? account
      : null;
  };
  const getCashuWalletForMint = async (
    mintUrl: string,
  ): Promise<ExtendedCashuWallet> => {
    const userId = await getUserId();
    if (!userId) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    const accounts = await accountRepository.getAllActive(userId);
    const account = accounts.find(
      (a): a is CashuAccount =>
        a.type === 'cashu' &&
        a.isOnline &&
        areMintUrlsEqual(a.mintUrl, mintUrl),
    );
    if (!account) {
      throw new SdkError(
        `No online cashu account for mint ${mintUrl}`,
        'cashu_wallet_unavailable',
      );
    }
    return account.wallet;
  };

  const cashuSendQuoteRepo = new CashuSendQuoteRepository(supabase, encryption);
  const cashuSendSwapRepo = new CashuSendSwapRepository(supabase, encryption);
  const cashuReceiveQuoteRepo = new CashuReceiveQuoteRepository(
    supabase,
    encryption,
    accountRepository,
  );
  const cashuReceiveSwapRepo = new CashuReceiveSwapRepository(
    supabase,
    encryption,
    accountRepository,
  );
  const sparkSendQuoteRepo = new SparkSendQuoteRepository(supabase, encryption);
  const sparkReceiveQuoteRepo = new SparkReceiveQuoteRepository(
    supabase,
    encryption,
  );
  const transactionRepo = new TransactionRepository(supabase, encryption);

  const cashuSendQuoteService = new CashuSendQuoteService(cashuSendQuoteRepo);
  const cashuReceiveQuoteService = new CashuReceiveQuoteService(
    cashuCrypto,
    cashuReceiveQuoteRepo,
  );
  const cashuReceiveSwapService = new CashuReceiveSwapService(
    cashuReceiveSwapRepo,
  );
  const cashuSendSwapService = new CashuSendSwapService(
    cashuSendSwapRepo,
    cashuReceiveSwapService,
  );
  const sparkSendQuoteService = new SparkSendQuoteService(sparkSendQuoteRepo);
  const sparkReceiveQuoteService = new SparkReceiveQuoteService(
    sparkReceiveQuoteRepo,
  );

  const cashuSendMeltMgr = new MeltQuoteSubscriptionManager(
    getCashuWalletForMint,
  );
  const cashuReceiveMintMgr = new MintQuoteSubscriptionManager(
    getCashuWalletForMint,
  );
  const cashuReceiveMeltMgr = new MeltQuoteSubscriptionManager(
    getCashuWalletForMint,
  );
  const proofMgr = new ProofStateSubscriptionManager(getCashuWalletForMint);
  const sparkReceiveMeltMgr = new MeltQuoteSubscriptionManager(
    getCashuWalletForMint,
  );

  // Shared cross-mint melt handler — runs on the SOURCE cashu wallet. `tokenProofs`
  // are already cashu-ts protocol `Proof`s (CashuProtocolProof), so they are passed
  // straight through (no domain→protocol map), mirroring claim-cashu-token-service.
  const initiateMelt = async (quote: {
    tokenReceiveData: CashuTokenMeltData;
  }): Promise<void> => {
    const data = quote.tokenReceiveData;
    const sourceWallet = await getCashuWalletForMint(data.sourceMintUrl);
    await sourceWallet.meltProofsIdempotent(
      {
        quote: data.meltQuoteId,
        amount: data.tokenAmount.toNumber(
          getCashuUnit(data.tokenAmount.currency),
        ),
      },
      data.tokenProofs,
      undefined,
      { type: 'random' },
    );
  };

  const cashuSend = new CashuSendOrchestrator({
    sendQuoteService: cashuSendQuoteService,
    sendQuoteRepository: cashuSendQuoteRepo,
    getAccount: getCashuAccount,
    meltSubscriptionManager: cashuSendMeltMgr,
    emitter,
  });
  const cashuSendSwap = new CashuSendSwapOrchestrator({
    sendSwapService: cashuSendSwapService,
    getAccount: getCashuAccount,
    proofStateSubscriptionManager: proofMgr,
    emitter,
  });
  const cashuReceiveQuote = new CashuReceiveQuoteOrchestrator({
    receiveQuoteService: cashuReceiveQuoteService,
    getAccount: getCashuAccount,
    mintSubscriptionManager: cashuReceiveMintMgr,
    meltSubscriptionManager: cashuReceiveMeltMgr,
    emitter,
  });
  const cashuReceiveSwap = new CashuReceiveSwapOrchestrator({
    receiveSwapService: cashuReceiveSwapService,
    getAccount: getCashuAccount,
    emitter,
  });
  const sparkSend = new SparkSendOrchestrator({
    sendQuoteService: sparkSendQuoteService,
    getAccount: getSparkAccount,
    emitter,
  });
  const sparkReceive = new SparkReceiveOrchestrator({
    receiveQuoteService: sparkReceiveQuoteService,
    getAccount: getSparkAccount,
    meltSubscriptionManager: sparkReceiveMeltMgr,
    emitter,
  });

  const balanceListener = new SparkBalanceListener({ emitter });
  const registerBalanceListeners = async (
    userId: string,
  ): Promise<() => void> => {
    const accounts = await accountRepository.getAllActive(userId);
    const sparkAccounts = accounts.filter(
      (a): a is SparkAccount => a.type === 'spark' && a.isOnline,
    );
    const cleanups = await Promise.all(
      sparkAccounts.map((a) => balanceListener.register(a)),
    );
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  };

  const forwarder = new WalletChangesForwarder({
    realtime,
    emitter,
    transactionRepository: transactionRepo,
    accountRepository,
    toUser,
  });
  const lockRepository = new TaskProcessingLockRepository(supabase);
  const taskLoop = new TaskLoop({
    repos: {
      cashuSendQuote: cashuSendQuoteRepo,
      cashuSendSwap: cashuSendSwapRepo,
      cashuReceiveQuote: cashuReceiveQuoteRepo,
      cashuReceiveSwap: cashuReceiveSwapRepo,
      sparkSendQuote: sparkSendQuoteRepo,
      sparkReceiveQuote: sparkReceiveQuoteRepo,
    },
    orchestrators: {
      cashuSend,
      cashuSendSwap,
      cashuReceiveQuote,
      cashuReceiveSwap,
      sparkSend,
      sparkReceive,
    },
    cashuReceiveQuoteService,
    cashuSendQuoteService,
    initiateMelt,
    getUserId,
    emitter,
  });

  const runner = new BackgroundRunner({
    lockRepository,
    taskLoop,
    forwarder,
    registerBalanceListeners,
    getUserId,
    clientId: config.clientId ?? crypto.randomUUID(),
    emitter,
  });

  return {
    start: () => runner.start(),
    stop: () => runner.stop(),
    state: () => runner.state(),
  };
}
