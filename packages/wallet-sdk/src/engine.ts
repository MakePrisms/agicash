import type { Currency } from '@agicash/money';
import type { SdkConfig } from './config';
import type { CashuAccount, SparkAccount } from './domains/account-types';
import type { CashuReceiveQuote } from './domains/cashu-receive-quote';
import type { CashuReceiveSwap } from './domains/cashu-receive-swap';
import type { CashuSendQuote } from './domains/cashu-send-quote';
import type { CashuSendSwap } from './domains/cashu-send-swap';
import type { SparkReceiveQuote } from './domains/spark-receive-quote';
import type { SparkSendQuote } from './domains/spark-send-quote';
import type { ExtendedCashuWallet } from './internal/cashu/wallet';
import type { EventBus } from './internal/event-bus';
import type { EntityFanout } from './internal/realtime/change-feed-ports';
import type { ChangeFeedChange } from './internal/realtime/change-feed-router';
import type { RetryPolicy } from './internal/tasks/retry-policy';
import type { TaskRunner } from './internal/tasks/task-runner';
import type { WalletRuntime } from './internal/wallet-runtime';
import type { SdkCoreEventMap } from './events';

// Seam surface the variant implements / references. Re-exported for variant packages only.
export type { TaskRunner, RetryPolicy, EntityFanout, ChangeFeedChange, WalletRuntime };

/**
 * The six background work sets, already filtered to processable items (online
 * accounts only — see the app's `useSelectItemsWithOnlineAccount`). Variant A
 * reads the DB on demand via `runtime.protocols.*Repository.getUnresolved/getPending(userId)`;
 * variant B reads its resident stores (kept fresh by the change-feed fan-out).
 */
export type WorkSetSource = {
  getUnresolvedCashuSendQuotes(userId: string): Promise<CashuSendQuote[]>;
  getUnresolvedCashuSendSwaps(userId: string): Promise<CashuSendSwap[]>;
  getUnresolvedSparkSendQuotes(userId: string): Promise<SparkSendQuote[]>;
  getPendingCashuReceiveQuotes(userId: string): Promise<CashuReceiveQuote[]>;
  getPendingCashuReceiveSwaps(userId: string): Promise<CashuReceiveSwap[]>;
  getPendingSparkReceiveQuotes(userId: string): Promise<SparkReceiveQuote[]>;
};

/**
 * Resident account + wallet resolution the processors/trackers need synchronously.
 * The variant builds these from its resident accounts (which carry warm `.wallet`
 * handles) + the base mint cache. Mirrors the app's `getCashuAccount`,
 * `getSparkAccount`, `getCashuAccountByMintUrlAndCurrency(...)?.wallet ?? getCashuWallet(mintUrl)`,
 * and the `getInitializedCashuWallet` source fallback.
 */
export type WalletAccess = {
  /** accountId → resident cashu account (carries `.wallet`, `.mintUrl`, `.currency`, `.proofs`). */
  getCashuAccount(accountId: string): CashuAccount;
  /** accountId → resident spark account (carries `.wallet`). */
  getSparkAccount(accountId: string): SparkAccount;
  /** mintUrl+currency → a cashu wallet for CHECKING a melt quote: a resident account's wallet if present, else a bare `getCashuWallet(mintUrl)`. */
  getCashuWalletByMint(mintUrl: string, currency: Currency): ExtendedCashuWallet;
  /**
   * Token-receive melt path: a fully-initialized source wallet for an arbitrary
   * mint+currency — a resident account at that mint if present, else
   * `getInitializedCashuWallet(...)`. Rejects (NetworkError) if the mint is offline.
   */
  getSourceCashuWallet(mintUrl: string, currency: Currency): Promise<ExtendedCashuWallet>;
};

/**
 * The variant-supplied engine. Base ships NO implementation (the accepted
 * "inject ports, no base default" decision): without a `createEngine`, the SDK
 * has no background processing and `sdk.background.start()` throws. Variant A
 * (KeyedQueue + DB-on-demand + row-event fan-out) and variant B (patched
 * query-core + resident stores + store-write fan-out) each provide one.
 */
export type SdkEngine = {
  runner: TaskRunner;
  workSets: WorkSetSource;
  wallets: WalletAccess;
  fanout: EntityFanout;
};

/** What the variant's `createEngine` receives to build the engine pieces. */
export type EngineContext = {
  events: EventBus<SdkCoreEventMap>;
  runtime: WalletRuntime;
  config: SdkConfig;
};

export type CreateEngine = (ctx: EngineContext) => SdkEngine;
