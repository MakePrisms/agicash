/**
 * `CashuDomain` implementation — §5 of the contract, Slice 3 / PR5b (cashu send + receive ops).
 *
 * Wires the framework-free cashu SERVICE primitives (`internal/cashu-*-service.ts`, re-housed
 * from `apps/web-wallet/app/features/{send,receive}/*`) into the public `CashuSendOps` /
 * `CashuReceiveOps` surface, replacing PR2's `createCashuStub`. The services use each account's
 * LIVE `ExtendedCashuWallet` handle (PR5a) + the SDK-owned Supabase repos.
 *
 * TWO-MODE API rule: `createLightningQuote`/`createTokenQuote`/`receiveToken` are kickoffs
 * (params + the FULL account); `failQuote`/`reverse` take FULL objects; `get` is a fetch.
 *
 * **`executeQuote` — DEFERRED to the orchestrator sub-slice (PR5d).** Per the build plan, the
 * unified `executeQuote` orchestrator is the single biggest net-new construct — a framework-free
 * state machine that absorbs master's six React-resident `useProcess*Tasks` hooks (each a
 * TanStack mutation + retry/MintOperationError branch + a live mint-WS `*SubscriptionManager`)
 * and drives UNPAID→PENDING→PAID off DB state. The plan (§1 + §4) keeps that state-machine core
 * as its own reviewable unit and PR5b ships the IDEMPOTENT PRIMITIVES it will call
 * (`initiateSend`/`markSendQuoteAsPending`/`completeSendQuote`/`failSendQuote` + the swap/claim
 * services, with `wallet.restore` recovery + the DB reservation / CONCURRENCY_ERROR guards
 * preserved). `executeQuote` is therefore a documented stub here — see {@link CashuSendOpsImpl.executeQuote}.
 *
 * @module
 */
import type { AccountRepository } from '../internal/account-repository';
import type { CashuReceiveQuoteService } from '../internal/cashu-receive-quote-service';
import type { CashuSendQuoteService } from '../internal/cashu-send-quote-service';
import type { CashuSendSwapService } from '../internal/cashu-send-swap-service';
import { getInvoiceFromLud16, isLNURLError } from '../internal/lib-lnurl';
import type { CashuReceiveQuoteRepository } from '../internal/cashu-receive-quote-repository';
import type { CashuSendQuoteRepository } from '../internal/cashu-send-quote-repository';
import type { CashuSendSwapRepository } from '../internal/cashu-send-swap-repository';
import type { SessionResolver } from '../internal/session';
import type { CashuDomain, CashuReceiveOps, CashuSendOps } from '../domains';
import { DomainError, NotImplementedError } from '../errors';
import type { Account, CashuAccount } from '../types/account';
import type {
  CashuReceiveQuote,
  CashuSendQuote,
  CashuSendSwap,
} from '../types/cashu';
import type { SparkReceiveQuote } from '../types/spark';
import type { Money } from '../types/money';

/**
 * Cashu SEND operations. Holds the lightning-send + token-send services + their repos (for
 * `get`/`reverse`) + the account repo + session.
 */
export class CashuSendOpsImpl implements CashuSendOps {
  constructor(
    private readonly sendQuoteService: CashuSendQuoteService,
    private readonly sendSwapService: CashuSendSwapService,
    private readonly sendQuoteRepository: CashuSendQuoteRepository,
    private readonly sendSwapRepository: CashuSendSwapRepository,
    private readonly accounts: AccountRepository,
    private readonly session: SessionResolver,
  ) {}

  /**
   * Create a cashu lightning send quote. `destination` is a bolt11 invoice OR a Lightning
   * address; an ln-address is resolved internally via LNURL-pay using `amount` (the contract's
   * fold, §3 — NOT a scan step). Then delegates to the lightning-send service
   * (`getLightningQuote` + `createSendQuote`).
   *
   * @param params.account - the FULL cashu account to send from (its live wallet is used).
   * @param params.destination - a bolt11 invoice or a `user@domain` Lightning address.
   * @param params.amount - required for an ln-address / amountless invoice.
   * @returns the created {@link CashuSendQuote} (UNPAID).
   */
  async createLightningQuote(params: {
    account: CashuAccount;
    destination: string;
    amount?: Money;
  }): Promise<CashuSendQuote> {
    const user = await this.session.requireCurrentUser();
    const { paymentRequest, lnAddress } = await this.resolveDestination(
      params.destination,
      params.amount,
    );

    const lightningQuote = await this.sendQuoteService.getLightningQuote({
      account: params.account,
      paymentRequest,
      amount: params.amount,
    });

    return this.sendQuoteService.createSendQuote({
      userId: user.id,
      account: params.account,
      sendQuote: {
        paymentRequest: lightningQuote.paymentRequest,
        amountRequested: lightningQuote.amountRequested,
        amountRequestedInBtc: lightningQuote.amountRequestedInBtc,
        meltQuote: lightningQuote.meltQuote,
      },
      destinationDetails: lnAddress
        ? { sendType: 'LN_ADDRESS', lnAddress }
        : undefined,
    });
  }

  /**
   * Create a cashu TOKEN send — returns a {@link CashuSendSwap} (not a lightning quote). The
   * sender pays the fees (master's only supported mode). Delegates to the token-send service.
   *
   * @param params.account - the FULL cashu account to send from.
   * @param params.amount - the amount to send (in the account's currency).
   * @returns the created {@link CashuSendSwap} (DRAFT or PENDING).
   */
  async createTokenQuote(params: {
    account: CashuAccount;
    amount: Money;
  }): Promise<CashuSendSwap> {
    const user = await this.session.requireCurrentUser();
    return this.sendSwapService.create({
      userId: user.id,
      account: params.account,
      amount: params.amount,
      senderPaysFee: true,
    });
  }

  /**
   * DEFERRED (orchestrator sub-slice, PR5d). `executeQuote` IS the orchestrator — the
   * framework-free state machine that drives UNPAID → PENDING → PAID off DB state + the mint
   * melt-quote WS subscription (master has only the React `TaskProcessor`). PR5b ships the
   * idempotent primitives it sequences (`initiateSend` / `markSendQuoteAsPending` /
   * `completeSendQuote` / `failSendQuote`, with `wallet.restore` recovery + the DB
   * CONCURRENCY_ERROR guard) but NOT the drive loop. Throws {@link NotImplementedError}.
   *
   * @param _quote - the quote to drive (full object on the kickoff path).
   */
  executeQuote(_quote: CashuSendQuote): Promise<CashuSendQuote> {
    throw new NotImplementedError(
      'cashu.send.executeQuote (the orchestrator state machine lands in the PR5d orchestrator sub-slice; PR5b ships the idempotent send primitives it drives)',
    );
  }

  /**
   * Mark a send quote FAILED (FULL object). Re-checks the mint melt quote is UNPAID first (so
   * an in-flight/paid send is never failed). Delegates to the service.
   *
   * @param quote - the FULL quote to fail.
   * @param reason - the failure reason.
   */
  async failQuote(quote: CashuSendQuote, reason: string): Promise<void> {
    const account = await this.requireCashuAccount(quote.accountId);
    await this.sendQuoteService.failSendQuote(account, quote, reason);
  }

  /**
   * Reverse a PENDING token send (decision 8): reclaim `proofsToSend` via a new cashu receive
   * swap tagged `reversedTransactionId`. Refetches the account (for its live wallet) then
   * delegates to the service. The swap lands REVERSED DB-side.
   *
   * @param swap - the FULL pending token-send swap.
   * @returns the swap (the caller polls `get`/events for the REVERSED state).
   */
  async reverse(swap: CashuSendSwap): Promise<CashuSendSwap> {
    const account = await this.requireCashuAccount(swap.accountId);
    await this.sendSwapService.reverse(swap, account);
    return swap;
  }

  /**
   * Fetch a send quote OR token-send swap by id (fetch). Tries the lightning-send quote first,
   * then the token-send swap.
   *
   * @param id - the quote/swap id.
   * @returns the quote/swap, or null if neither exists.
   */
  async get(id: string): Promise<CashuSendQuote | CashuSendSwap | null> {
    const quote = await this.sendQuoteRepository.get(id);
    if (quote) {
      return quote;
    }
    return this.sendSwapRepository.get(id);
  }

  /**
   * Resolve `destination` to a bolt11 invoice. A `user@domain` Lightning address is resolved
   * via LNURL-pay using `amount` (required); a bolt11 invoice is returned as-is.
   */
  private async resolveDestination(
    destination: string,
    amount?: Money,
  ): Promise<{ paymentRequest: string; lnAddress?: string }> {
    if (!destination.includes('@')) {
      return { paymentRequest: destination };
    }

    if (!amount) {
      throw new DomainError('An amount is required to pay a Lightning address');
    }
    if (amount.currency !== 'BTC') {
      // LNURL-pay requests a msat amount; the SDK resolves ln-addresses in BTC. (A USD-account
      // send to an ln-address would convert via exchange rate — that path rides with exchangeRate.)
      throw new DomainError(
        'A BTC amount is required to pay a Lightning address',
      );
    }

    const invoiceResult = await getInvoiceFromLud16(
      destination,
      amount as Money<'BTC'>,
    );
    if (isLNURLError(invoiceResult)) {
      throw new DomainError(invoiceResult.reason);
    }
    return { paymentRequest: invoiceResult.pr, lnAddress: destination };
  }

  /** Fetch + assert the account is a live cashu account (for the wallet-using service calls). */
  private async requireCashuAccount(id: string): Promise<CashuAccount> {
    const account = await this.accounts.get(id);
    if (!account || account.type !== 'cashu') {
      throw new DomainError('Cashu account not found');
    }
    return account;
  }
}

/**
 * Cashu RECEIVE operations. Holds the receive-quote + receive-swap services + the receive-quote
 * repo (for `get`) + the account repo + session.
 */
export class CashuReceiveOpsImpl implements CashuReceiveOps {
  constructor(
    private readonly receiveQuoteService: CashuReceiveQuoteService,
    private readonly receiveQuoteRepository: CashuReceiveQuoteRepository,
    private readonly session: SessionResolver,
  ) {}

  /**
   * Claim a cashu token. DEFERRED to the orchestrator sub-slice (PR5d) at the PUBLIC surface.
   *
   * The IDEMPOTENT PRIMITIVE is shipped + tested in PR5b — `CashuReceiveSwapService.create`
   * (same-mint claim: create a receive swap + reserve, with `wallet.restore` double-claim
   * recovery in `completeSwap`). What this public method additionally needs is the full claim
   * FLOW master implements in `ClaimCashuTokenService`: destination-account resolution (add the
   * mint if unknown, set-default UX), same-mint-vs-cross-account ROUTING, the cross-account
   * melt-then-mint quote path (token → a different mint, or token → spark), and the
   * result-surface reconciliation (a same-mint claim produces a receive SWAP, but this method's
   * declared result is a receive/spark QUOTE — only the cross-account path yields a quote). That
   * flow is orchestrated over account/user services + exchange-rate fetches not yet in the SDK,
   * and folds in with the orchestrator + transfers slices. Throws {@link NotImplementedError}
   * (no side effects) rather than half-driving a claim.
   *
   * @param _params.token - the encoded cashu token string.
   * @param _params.destinationAccount - the account to claim into.
   */
  receiveToken(_params: {
    token: string;
    destinationAccount?: Account;
  }): Promise<CashuReceiveQuote | SparkReceiveQuote> {
    throw new NotImplementedError(
      'cashu.receive.receiveToken (the claim FLOW — account resolution + same/cross routing + the cross-account melt-then-mint quote — lands with the PR5d orchestrator + transfers; PR5b ships the same-mint receive-swap primitive it builds on)',
    );
  }

  /**
   * Create a cashu lightning receive quote (an invoice to be paid). `purpose` defaults to
   * `'PAYMENT'`; `'BUY_CASHAPP'` is the buy-bitcoin / Cash App flow. Delegates to the
   * receive-quote service (`getLightningQuote` + `createReceiveQuote`).
   *
   * @param params.account - the FULL cashu account to receive into.
   * @param params.amount - the amount to receive.
   * @param params.purpose - `'PAYMENT'` (default) or `'BUY_CASHAPP'`.
   * @returns the created {@link CashuReceiveQuote} (UNPAID).
   */
  async createLightningQuote(params: {
    account: CashuAccount;
    amount: Money;
    purpose?: 'PAYMENT' | 'BUY_CASHAPP';
  }): Promise<CashuReceiveQuote> {
    const user = await this.session.requireCurrentUser();
    const description =
      params.purpose === 'BUY_CASHAPP' ? 'Pay to Agicash' : undefined;

    const lightningQuote = await this.receiveQuoteService.getLightningQuote({
      wallet: params.account.wallet,
      amount: params.amount,
      description,
    });

    return this.receiveQuoteService.createReceiveQuote({
      userId: user.id,
      account: params.account,
      lightningQuote,
      receiveType: 'LIGHTNING',
      purpose: params.purpose ?? 'PAYMENT',
    });
  }

  /**
   * Fetch a receive quote by id (fetch).
   *
   * @param quoteId - the quote id.
   * @returns the quote, or null.
   */
  async get(quoteId: string): Promise<CashuReceiveQuote | null> {
    return this.receiveQuoteRepository.get(quoteId);
  }
}

/** The cashu domain — `.send` + `.receive`. */
export class CashuDomainImpl implements CashuDomain {
  constructor(
    readonly send: CashuSendOps,
    readonly receive: CashuReceiveOps,
  ) {}
}
