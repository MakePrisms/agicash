import type { MintValidator } from '@agicash/cashu';
import type { AgicashDb } from '@agicash/db-types';
import type { Money } from '@agicash/utils/money';
import type { Token } from '@cashu/cashu-ts';
import type { QueryClient } from '@tanstack/query-core';
import type { CashuAccount, SparkAccount } from '../accounts/account';
import type { AccountRepository } from '../accounts/account-repository';
import type { AccountService } from '../accounts/account-service';
import { getCashuCryptography } from '../cashu';
import type { Encryption } from '../encryption';
import type { TransactionPurpose } from '../transactions/transaction-enums';
import type { User } from '../user/user';
import type { UserService } from '../user/user-service';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import {
  CashuReceiveQuoteCache,
  PendingCashuReceiveQuotesCache,
  createCashuReceiveQuoteChangeHandlers,
} from './cashu-receive-quote-cache';
import { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import {
  PendingCashuReceiveSwapsCache,
  createCashuReceiveSwapChangeHandlers,
} from './cashu-receive-swap-cache';
import { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';
import { CashuReceiveSwapService } from './cashu-receive-swap-service';
import {
  ClaimCashuTokenService,
  type ClaimTokenResult,
} from './claim-cashu-token-service';
import { ReceiveCashuTokenQuoteService } from './receive-cashu-token-quote-service';
import { ReceiveCashuTokenService } from './receive-cashu-token-service';
import type { SparkReceiveQuote } from './spark-receive-quote';
import {
  PendingSparkReceiveQuotesCache,
  SparkReceiveQuoteCache,
  createSparkReceiveQuoteChangeHandlers,
} from './spark-receive-quote-cache';
import { getLightningQuote as getSparkLightningQuote } from './spark-receive-quote-core';
import { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';
import { SparkReceiveQuoteService } from './spark-receive-quote-service';

type CreateReceiveQuoteParams<TAccount> = {
  /** The account to receive into. */
  account: TAccount;
  /** The amount to receive. */
  amount: Money;
  /** Description to include in the Lightning invoice memo. */
  description?: string;
  /** The purpose of this transaction (e.g. a Cash App buy). */
  purpose?: TransactionPurpose;
  /** UUID linking paired send/receive transactions in a transfer. */
  transferId?: string;
};

export type ReceiveApi = {
  /**
   * Claims a cashu token for the current user to a cashu or spark account.
   * Adds the receiving account if it is unknown, switches the default account
   * when needed, and starts (and best-effort completes) the claim; incomplete
   * claims are picked up by background processing.
   */
  claimToken: (
    token: Token,
    claimTo: 'cashu' | 'spark',
  ) => Promise<ClaimTokenResult>;
  /**
   * Creates a cashu receive quote (a Lightning invoice to be paid into the
   * cashu account) for the current user and records it as the active quote.
   */
  createCashuReceiveQuote: (
    params: CreateReceiveQuoteParams<CashuAccount>,
  ) => Promise<CashuReceiveQuote>;
  /**
   * Creates a spark receive quote (a Lightning invoice to be paid into the
   * spark account) for the current user and records it as the active quote.
   */
  createSparkReceiveQuote: (
    params: CreateReceiveQuoteParams<SparkAccount>,
  ) => Promise<SparkReceiveQuote>;
  /**
   * Creates a cashu receive swap claiming the token into the account. The
   * pending-swaps state is recorded by the CASHU_RECEIVE_SWAP_CREATED
   * realtime broadcast, not here.
   */
  createCashuReceiveSwap: (params: {
    token: Token;
    account: CashuAccount;
  }) => Promise<{ swap: CashuReceiveSwap; account: CashuAccount }>;
  /**
   * Query config for tracking a single cashu receive quote (the active one).
   * Pass undefined while no quote exists and gate with `enabled`.
   */
  cashuQuoteOptions: (quoteId: string | undefined) => {
    queryKey: (string | undefined)[];
    queryFn: () => Promise<CashuReceiveQuote | null>;
    staleTime: number;
  };
  /**
   * Query config for tracking a single spark receive quote (the active one).
   * Pass undefined while no quote exists and gate with `enabled`.
   */
  sparkQuoteOptions: (quoteId: string | undefined) => {
    queryKey: (string | undefined)[];
    queryFn: () => Promise<SparkReceiveQuote | null>;
    staleTime: number;
  };
  /** Query config for the current user's pending cashu receive quotes. */
  pendingCashuQuotesOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<CashuReceiveQuote[]>;
    staleTime: number;
  };
  /** Query config for the current user's pending spark receive quotes. */
  pendingSparkQuotesOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<SparkReceiveQuote[]>;
    staleTime: number;
  };
  /** Query config for the current user's pending cashu receive swaps. */
  pendingCashuSwapsOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<CashuReceiveSwap[]>;
    staleTime: number;
  };
  /**
   * Transitional escape hatch — NOT part of the public surface. Only for the
   * web-owned tracking/task-processing hooks and realtime wiring until the
   * SDK owns the realtime hub and background processing (Phase 8). App/UI
   * code must use the curated methods above.
   */
  internal: {
    cashuReceiveQuoteRepository: CashuReceiveQuoteRepository;
    cashuReceiveSwapRepository: CashuReceiveSwapRepository;
    sparkReceiveQuoteRepository: SparkReceiveQuoteRepository;
    cashuReceiveQuoteService: CashuReceiveQuoteService;
    cashuReceiveSwapService: CashuReceiveSwapService;
    sparkReceiveQuoteService: SparkReceiveQuoteService;
    receiveCashuTokenService: ReceiveCashuTokenService;
    receiveCashuTokenQuoteService: ReceiveCashuTokenQuoteService;
    cashuReceiveQuoteCache: CashuReceiveQuoteCache;
    pendingCashuReceiveQuotesCache: PendingCashuReceiveQuotesCache;
    sparkReceiveQuoteCache: SparkReceiveQuoteCache;
    pendingSparkReceiveQuotesCache: PendingSparkReceiveQuotesCache;
    pendingCashuReceiveSwapsCache: PendingCashuReceiveSwapsCache;
    changeHandlers: {
      cashuReceiveQuote: ReturnType<
        typeof createCashuReceiveQuoteChangeHandlers
      >;
      sparkReceiveQuote: ReturnType<
        typeof createSparkReceiveQuoteChangeHandlers
      >;
      cashuReceiveSwap: ReturnType<typeof createCashuReceiveSwapChangeHandlers>;
    };
  };
};

export type ReceiveApiDeps = {
  queryClient: QueryClient;
  db: AgicashDb;
  encryption: Encryption;
  /**
   * Resolves the current user's id from the SDK's user state.
   * @throws if no user is loaded yet.
   */
  getCurrentUserId: () => string;
  /**
   * Resolves the current user from the SDK's user state.
   * @throws if no user is loaded yet.
   */
  getCurrentUser: () => User;
  accountRepository: AccountRepository;
  accountService: AccountService;
  userService: UserService;
  /** Host-provided mint validation policy (blocklist is host-env-derived). */
  cashuMintValidator: MintValidator;
};

export function createReceiveApi(deps: ReceiveApiDeps): ReceiveApi {
  const {
    queryClient,
    db,
    encryption,
    getCurrentUserId,
    getCurrentUser,
    accountRepository,
    accountService,
    userService,
    cashuMintValidator,
  } = deps;

  const cashuCryptography = getCashuCryptography(queryClient);

  const cashuReceiveQuoteRepository = new CashuReceiveQuoteRepository(
    db,
    encryption,
    accountRepository,
  );
  const cashuReceiveSwapRepository = new CashuReceiveSwapRepository(
    db,
    encryption,
    accountRepository,
  );
  const sparkReceiveQuoteRepository = new SparkReceiveQuoteRepository(
    db,
    encryption,
  );

  const cashuReceiveQuoteService = new CashuReceiveQuoteService(
    cashuCryptography,
    cashuReceiveQuoteRepository,
  );
  const cashuReceiveSwapService = new CashuReceiveSwapService(
    cashuReceiveSwapRepository,
  );
  const sparkReceiveQuoteService = new SparkReceiveQuoteService(
    sparkReceiveQuoteRepository,
  );
  const receiveCashuTokenService = new ReceiveCashuTokenService(
    queryClient,
    cashuMintValidator,
  );
  const receiveCashuTokenQuoteService = new ReceiveCashuTokenQuoteService(
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
  );
  const claimCashuTokenService = new ClaimCashuTokenService(
    queryClient,
    accountRepository,
    accountService,
    cashuReceiveSwapService,
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
    receiveCashuTokenService,
    receiveCashuTokenQuoteService,
    userService,
  );

  const cashuReceiveQuoteCache = new CashuReceiveQuoteCache(queryClient);
  const pendingCashuReceiveQuotesCache = new PendingCashuReceiveQuotesCache(
    queryClient,
  );
  const sparkReceiveQuoteCache = new SparkReceiveQuoteCache(queryClient);
  const pendingSparkReceiveQuotesCache = new PendingSparkReceiveQuotesCache(
    queryClient,
  );
  const pendingCashuReceiveSwapsCache = new PendingCashuReceiveSwapsCache(
    queryClient,
  );

  return {
    claimToken: (token, claimTo) =>
      claimCashuTokenService.claimToken(getCurrentUser(), token, claimTo),
    createCashuReceiveQuote: async ({
      account,
      amount,
      description,
      purpose,
      transferId,
    }) => {
      const lightningQuote = await cashuReceiveQuoteService.getLightningQuote({
        wallet: account.wallet,
        amount,
        description,
      });

      const quote = await cashuReceiveQuoteService.createReceiveQuote({
        userId: getCurrentUserId(),
        account,
        receiveType: 'LIGHTNING',
        lightningQuote,
        purpose,
        transferId,
      });
      cashuReceiveQuoteCache.add(quote);
      return quote;
    },
    createSparkReceiveQuote: async ({
      account,
      amount,
      description,
      purpose,
      transferId,
    }) => {
      const lightningQuote = await getSparkLightningQuote({
        wallet: account.wallet,
        amount,
        description,
      });

      const quote = await sparkReceiveQuoteService.createReceiveQuote({
        userId: getCurrentUserId(),
        account,
        lightningQuote,
        receiveType: 'LIGHTNING',
        purpose,
        transferId,
      });
      sparkReceiveQuoteCache.add(quote);
      return quote;
    },
    createCashuReceiveSwap: ({ token, account }) =>
      cashuReceiveSwapService.create({
        userId: getCurrentUserId(),
        token,
        account,
      }),
    cashuQuoteOptions: (quoteId) => ({
      queryKey: [CashuReceiveQuoteCache.Key, quoteId],
      queryFn: () => {
        if (!quoteId) {
          throw new Error('quoteId is required');
        }
        return cashuReceiveQuoteRepository.get(quoteId);
      },
      staleTime: Number.POSITIVE_INFINITY,
    }),
    sparkQuoteOptions: (quoteId) => ({
      queryKey: [SparkReceiveQuoteCache.Key, quoteId],
      queryFn: () => {
        if (!quoteId) {
          throw new Error('quoteId is required');
        }
        return sparkReceiveQuoteRepository.get(quoteId);
      },
      staleTime: Number.POSITIVE_INFINITY,
    }),
    pendingCashuQuotesOptions: () => ({
      queryKey: [PendingCashuReceiveQuotesCache.Key],
      queryFn: () => cashuReceiveQuoteRepository.getPending(getCurrentUserId()),
      staleTime: Number.POSITIVE_INFINITY,
    }),
    pendingSparkQuotesOptions: () => ({
      queryKey: [PendingSparkReceiveQuotesCache.Key],
      queryFn: () => sparkReceiveQuoteRepository.getPending(getCurrentUserId()),
      staleTime: Number.POSITIVE_INFINITY,
    }),
    pendingCashuSwapsOptions: () => ({
      queryKey: [PendingCashuReceiveSwapsCache.Key],
      queryFn: () => cashuReceiveSwapRepository.getPending(getCurrentUserId()),
      staleTime: Number.POSITIVE_INFINITY,
    }),
    internal: {
      cashuReceiveQuoteRepository,
      cashuReceiveSwapRepository,
      sparkReceiveQuoteRepository,
      cashuReceiveQuoteService,
      cashuReceiveSwapService,
      sparkReceiveQuoteService,
      receiveCashuTokenService,
      receiveCashuTokenQuoteService,
      cashuReceiveQuoteCache,
      pendingCashuReceiveQuotesCache,
      sparkReceiveQuoteCache,
      pendingSparkReceiveQuotesCache,
      pendingCashuReceiveSwapsCache,
      changeHandlers: {
        cashuReceiveQuote: createCashuReceiveQuoteChangeHandlers(
          cashuReceiveQuoteRepository,
          cashuReceiveQuoteCache,
          pendingCashuReceiveQuotesCache,
        ),
        sparkReceiveQuote: createSparkReceiveQuoteChangeHandlers(
          sparkReceiveQuoteRepository,
          sparkReceiveQuoteCache,
          pendingSparkReceiveQuotesCache,
        ),
        cashuReceiveSwap: createCashuReceiveSwapChangeHandlers(
          cashuReceiveSwapRepository,
          pendingCashuReceiveSwapsCache,
        ),
      },
    },
  };
}
