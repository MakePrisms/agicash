/**
 * Cashu token-claim FLOW — Slice 3 / PR5d. The orchestration behind `cashu.receive.receiveToken`.
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/receive/claim-cashu-token-service.ts#claimToken`, narrowed to the
 * pieces the current SDK surface supports. It decodes the token, resolves the SOURCE cashu account
 * (building a placeholder wallet for a mint the user has no account for) and the DESTINATION
 * account, then ROUTES:
 *  - **same-mint** (destination mint+currency == source) → a {@link CashuReceiveSwapService} swap,
 *    driven to COMPLETED by the orchestrator (`stepCashuReceiveSwap`);
 *  - **cross-account, same-currency** (a different cashu mint, or spark) → the cross-account
 *    melt-then-mint via {@link ReceiveCashuTokenQuoteService}, driven by the orchestrator's
 *    cross-account melt machine.
 *
 * DIVERGENCE / DEFERRED (vs master, documented for review — folds in with the Slice-4
 * exchangeRate + user-service work):
 *  - master's `claimToken` ALSO adds an unknown destination mint as an account, sets it default,
 *    and fetches a cross-CURRENCY exchange rate. The SDK's `account.add` exists, but
 *    `userService.setDefaultAccount` (Slice 1/4) and the `exchangeRate` domain (still a stub) do
 *    NOT. So this flow:
 *      (a) requires the destination account to be one the SDK can resolve (the caller passes a full
 *          `destinationAccount`, or it defaults to the token's own mint = same-mint claim);
 *      (b) supports cross-account only for the SAME currency (`exchangeRate = '1'`); a
 *          cross-currency claim throws a `DomainError` pointing at the exchangeRate dependency.
 *    The set-default UX is a consumer concern (web already owns it) and is not reproduced here.
 *
 * @module
 */
import { type Token, getDecodedToken } from '@cashu/cashu-ts';
import type { AccountRepository } from './account-repository';
import type { CashuReceiveSwapService } from './cashu-receive-swap-service';
import type { MintMetadataCache } from './cashu-wallet';
import { getInitializedCashuWallet } from './cashu-wallet';
import type { ExtendedCashuWallet } from './lib-cashu-wallet';
import { areMintUrlsEqual, tokenToMoney } from './lib-cashu-quotes';
import { extractCashuToken } from './lib-scan';
import type { Orchestrator } from './orchestrator';
import type { ReceiveCashuTokenQuoteService } from './receive-cashu-token-quote-service';
import { DomainError } from '../errors';
import type { Account, CashuAccount } from '../types/account';
import type { Currency } from '../types/money';
import type { CashuReceiveQuote } from '../types/cashu';
import type { SparkReceiveQuote } from '../types/spark';

/** The SDK-internal collaborators the claim flow needs (a subset of the orchestrator's deps). */
export type ClaimCashuTokenDeps = {
  accounts: AccountRepository;
  cashuReceiveSwapService: CashuReceiveSwapService;
  receiveCashuTokenQuoteService: ReceiveCashuTokenQuoteService;
  orchestrator: Orchestrator;
  mintCache: MintMetadataCache;
};

/**
 * The result of a claim kickoff. Only the CROSS-account path yields the contract's receive quote;
 * a same-mint claim produces an internal receive SWAP (not representable in the locked
 * `receiveToken` return type) and is reported as `same-mint` WITHOUT a side effect so the caller
 * can surface the boundary cleanly (the same-mint swap primitive is built + tested; only its public
 * surfacing — a widened return type — is the PR5e follow-up).
 */
export type ClaimResult =
  | { kind: 'cross-account'; quote: CashuReceiveQuote | SparkReceiveQuote }
  | { kind: 'same-mint' };

/** Drives the token-claim flow behind `cashu.receive.receiveToken`. */
export class ClaimCashuTokenFlow {
  constructor(private readonly deps: ClaimCashuTokenDeps) {}

  /**
   * Decode + claim a token. Resolves source/destination, routes same-mint vs cross-account, kicks
   * off the orchestrator for completion, and returns the claim result. Resolves on KICK-OFF
   * (completion arrives via `receive:*` events).
   *
   * @param params.userId - the receiving user.
   * @param params.encodedToken - the encoded cashu token string.
   * @param params.destinationAccount - the account to claim into; defaults to the token's own mint
   *   (a same-mint claim) when the user has an account for it.
   * @returns the claim result.
   * @throws DomainError on an undecodable / unsupported token, or an unsupported cross-currency claim.
   */
  async claim(params: {
    userId: string;
    encodedToken: string;
    destinationAccount?: Account;
  }): Promise<ClaimResult> {
    const token = await this.decodeToken(params.encodedToken);
    const tokenCurrency = tokenToMoney(token).currency;

    const accounts = await this.deps.accounts.getAllActive(params.userId);
    const sourceAccount = await this.resolveSourceAccount(
      token,
      tokenCurrency,
      accounts,
    );

    const destinationAccount =
      params.destinationAccount ??
      this.resolveDefaultDestination(token, tokenCurrency, accounts);

    if (this.isSameMintClaim(sourceAccount, destinationAccount)) {
      // A same-mint claim yields an internal receive SWAP, not the contract's receive quote — report
      // it WITHOUT a side effect (decode + resolve above are read-only) so the caller surfaces the
      // boundary; the swap primitive is built + tested (see `claimSameMint`, used by the resume
      // sweep / a future widened surface).
      return { kind: 'same-mint' };
    }

    return this.claimCrossAccount(
      params.userId,
      token,
      sourceAccount,
      destinationAccount,
    );
  }

  /**
   * Same-mint claim primitive (BUILT + TESTED, not yet surfaced publicly): create the receive swap
   * and drive it to COMPLETED via the orchestrator. Not called from {@link claim} (which can't
   * return a quote for it) — retained for the Slice-5 resume sweep + a future widened `receiveToken`
   * return type (PR5e). Kept here so the same-mint mechanism lives next to the cross-account one.
   *
   * @param userId - the receiving user.
   * @param token - the decoded token (mint == the destination account's mint).
   * @param account - the destination (== source) cashu account.
   * @returns the created swap's transaction id (completion arrives via `receive:completed`).
   */
  async claimSameMint(
    userId: string,
    token: Token,
    account: CashuAccount,
  ): Promise<{ transactionId: string }> {
    const { swap } = await this.deps.cashuReceiveSwapService.create({
      userId,
      token,
      account,
    });
    await this.deps.orchestrator.stepCashuReceiveSwap(swap.tokenHash, userId);
    return { transactionId: swap.transactionId };
  }

  /** Decode the encoded token, fetching the source mint's keyset ids to validate (master `decodeCashuToken`). */
  private async decodeToken(encodedToken: string): Promise<Token> {
    const extracted = extractCashuToken(encodedToken);
    if (!extracted) {
      throw new DomainError('Invalid cashu token');
    }
    try {
      const metadata = await this.deps.mintCache.get(extracted.metadata.mint);
      const keysetIds = metadata.allMintKeysets.keysets.map((k) => k.id);
      return getDecodedToken(extracted.encoded, keysetIds);
    } catch (error) {
      const wrapped = new DomainError('Failed to decode cashu token');
      wrapped.cause = error;
      throw wrapped;
    }
  }

  /**
   * Resolve the SOURCE cashu account for the token's mint+currency: the user's existing account
   * for it, else a placeholder built from a freshly-initialised wallet (the cross-account path
   * melts from this even when the user has no account for the mint). Master
   * `ReceiveCashuTokenService.getSourceAndDestinationAccounts` / `buildAccountForMint`, narrowed.
   */
  private async resolveSourceAccount(
    token: Token,
    tokenCurrency: Currency,
    accounts: Account[],
  ): Promise<CashuAccount> {
    const existing = accounts.find(
      (a): a is CashuAccount =>
        a.type === 'cashu' &&
        areMintUrlsEqual(a.mintUrl, token.mint) &&
        a.currency === tokenCurrency,
    );
    if (existing) {
      return existing;
    }

    const { wallet, isOnline } = await getInitializedCashuWallet({
      cache: this.deps.mintCache,
      mintUrl: token.mint,
      currency: tokenCurrency,
    });
    if (!isOnline) {
      throw new DomainError('Source mint is offline');
    }
    return this.buildPlaceholderSourceAccount(
      token.mint,
      tokenCurrency,
      wallet,
    );
  }

  /** Build a non-persisted source `CashuAccount` for a mint the user has no account for (placeholder id). */
  private buildPlaceholderSourceAccount(
    mintUrl: string,
    currency: Currency,
    wallet: ExtendedCashuWallet,
  ): CashuAccount {
    return {
      id: 'cashu-account-placeholder-id',
      name: mintUrl.replace('https://', '').replace('http://', ''),
      type: 'cashu',
      purpose: 'transactional',
      state: 'active',
      isOnline: true,
      currency,
      createdAt: new Date().toISOString(),
      version: 0,
      expiresAt: null,
      mintUrl,
      isTestMint: false,
      keysetCounters: {},
      proofs: [],
      wallet,
    };
  }

  /**
   * Default the destination to the token's OWN mint (same-mint claim) when the user has an account
   * for it, mirroring master's default-receive-account preference for non-test mints' source.
   * When the user has no account for the token's mint there is no in-SDK default to choose without
   * the set-default UX, so the caller must pass a `destinationAccount`.
   */
  private resolveDefaultDestination(
    token: Token,
    tokenCurrency: Currency,
    accounts: Account[],
  ): Account {
    const ownMintAccount = accounts.find(
      (a): a is CashuAccount =>
        a.type === 'cashu' &&
        areMintUrlsEqual(a.mintUrl, token.mint) &&
        a.currency === tokenCurrency,
    );
    if (ownMintAccount) {
      return ownMintAccount;
    }
    throw new DomainError(
      'Pass a destinationAccount to claim a token from a mint you have no account for (auto-add + set-default is a Slice-4 / consumer concern).',
    );
  }

  /** Whether the claim is same-mint (destination mint+currency equals the source). */
  private isSameMintClaim(source: Account, destination: Account): boolean {
    return (
      source.type === 'cashu' &&
      destination.type === 'cashu' &&
      source.currency === destination.currency &&
      areMintUrlsEqual(source.mintUrl, destination.mintUrl)
    );
  }

  /**
   * Cross-account claim (a different cashu mint, or spark): build the paired source-melt +
   * destination-mint quotes, then kick off the orchestrator's cross-account melt machine. Returns
   * the destination receive quote (the contract's `receiveToken` result). Same-currency only (no
   * exchangeRate domain yet).
   */
  private async claimCrossAccount(
    userId: string,
    token: Token,
    sourceAccount: CashuAccount,
    destinationAccount: Account,
  ): Promise<ClaimResult> {
    if (sourceAccount.currency !== destinationAccount.currency) {
      throw new DomainError(
        'Cross-currency token claims are not supported yet (they need the exchangeRate domain — Slice 4 / PR5e).',
      );
    }

    const quotes =
      await this.deps.receiveCashuTokenQuoteService.createCrossAccountReceiveQuotes(
        {
          userId,
          token,
          sourceAccount,
          destinationAccount,
          // Same-currency: a 1:1 conversion (the exchangeRate domain is required only cross-currency).
          exchangeRate: '1',
        },
      );

    if (quotes.destinationType === 'cashu') {
      // Track the source melt + destination mint; the orchestrator drives both to completion.
      await this.deps.orchestrator.startCashuTokenReceiveQuote(
        quotes.cashuReceiveQuote as CashuReceiveQuote & { type: 'CASHU_TOKEN' },
      );
      return { kind: 'cross-account', quote: quotes.cashuReceiveQuote };
    }

    await this.deps.orchestrator.startSparkTokenReceiveQuote(
      quotes.sparkReceiveQuote as SparkReceiveQuote & { type: 'CASHU_TOKEN' },
    );
    return { kind: 'cross-account', quote: quotes.sparkReceiveQuote };
  }
}
