/**
 * `CashuDomain` implementation — §5 of the contract, Slice 3 / PR5b (ops) + PR5d (orchestrator).
 *
 * Wires the framework-free cashu SERVICE primitives (`internal/cashu-*-service.ts`, re-housed
 * from `apps/web-wallet/app/features/{send,receive}/*`) into the public `CashuSendOps` /
 * `CashuReceiveOps` surface, replacing PR2's `createCashuStub`. The services use each account's
 * LIVE `ExtendedCashuWallet` handle (PR5a) + the SDK-owned Supabase repos.
 *
 * TWO-MODE API rule: `createLightningQuote`/`createTokenQuote`/`receiveToken` are kickoffs
 * (params + the FULL account); `executeQuote`/`failQuote`/`reverse` take FULL objects; `get` is a
 * fetch.
 *
 * **`executeQuote` + `receiveToken` — wired through the orchestrator (PR5d).** `executeQuote` IS
 * the orchestrator (the build plan's single biggest net-new construct) — it hands the full quote
 * to the shared {@link Orchestrator}, which opens the mint melt-quote WS subscription and drives
 * UNPAID→PENDING→PAID off FRESH DB state (no cache). `receiveToken` drives the full token-claim
 * flow (same-mint receive swap + the cross-account melt-then-mint path) through the orchestrator and
 * — mirroring master `claimToken` — keeps the created swap/quote INTERNAL, resolving to a
 * lightweight `ReceiveTokenResult` (never throws; swallow-to-result).
 * Both resolve on KICK-OFF; the terminal arrives via `send:*`/`receive:*` events + a later `.get`.
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
import type { Orchestrator } from '../internal/orchestrator';
import type { ClaimCashuTokenFlow } from '../internal/claim-cashu-token-flow';
import type { SessionResolver } from '../internal/session';
import type { CashuDomain, CashuReceiveOps, CashuSendOps } from '../domains';
import { DomainError } from '../errors';
import type { Account, CashuAccount } from '../types/account';
import type {
  CashuReceiveQuote,
  CashuSendQuote,
  CashuSendSwap,
  ReceiveTokenResult,
} from '../types/cashu';
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
    private readonly orchestrator: Orchestrator,
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
    const swap = await this.sendSwapService.create({
      userId: user.id,
      account: params.account,
      amount: params.amount,
      senderPaysFee: true,
    });
    // A DRAFT swap needs the input proofs swapped for the exact proofs-to-send before a token can
    // be encoded. Kick that off through the orchestrator (returns the swap in its now-PENDING
    // state). A swap created PENDING (the account already held exact proofs) is returned as-is.
    return this.orchestrator.executeCashuSendSwap(swap);
  }

  /**
   * Execute a cashu lightning send — THE orchestrator (not a thin kickoff). Hands the full quote
   * to the shared {@link Orchestrator}, which opens the mint melt-quote WS subscription for the
   * quote's mint and drives UNPAID → PENDING → PAID off FRESH DB state (re-reading the quote on
   * each mint update, never a cache), preserving master's idempotency (`wallet.restore`) +
   * recovery + the `MintOperationError`→fail branch. Resolves on KICK-OFF (returns the quote in
   * its current state); the terminal arrives via `send:completed` / `send:failed` or `.get(id)`.
   *
   * @param quote - the FULL send quote (full object on the kickoff path).
   * @returns the quote in its current state (does NOT block until terminal).
   */
  executeQuote(quote: CashuSendQuote): Promise<CashuSendQuote> {
    return this.orchestrator.executeCashuSendQuote(quote);
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
    private readonly claimFlow: ClaimCashuTokenFlow,
  ) {}

  /**
   * Claim a received cashu token (PR5d). MIRRORS master `ClaimCashuTokenService.claimToken`: the
   * receive-swap / receive-quote it creates is INTERNAL (DB-persisted, driven to completion by the
   * background processor) and is NOT returned — this resolves to a lightweight
   * {@link ReceiveTokenResult}. Completion surfaces via `receive:completed` / `receive:failed`.
   *
   * **NEVER throws — swallow-to-result** (master's outer try/catch). A user-facing `DomainError`
   * becomes `{ success: false, message: error.message }`; any unexpected error is logged (with its
   * cause) and becomes `{ success: false, message: 'Unexpected error while claiming the token' }`.
   *
   * Decodes the token, resolves source/destination accounts, and routes the claim:
   *  - **same-mint** (default — `destinationAccount` omitted → master's default resolution into the
   *    token's own mint): creates a {@link CashuReceiveSwapService} swap and kicks the orchestrator;
   *  - **cross-account, same-currency** (`destinationAccount` is a different cashu mint, or spark):
   *    the melt-then-mint path (token → other-mint / token → spark).
   * Both return `{ success: true, destinationAccount: { id, purpose } }` on kickoff.
   *
   * Build-DEFERRED internal branches (vs master, see {@link ClaimCashuTokenFlow}) surface through
   * the result as `{ success: false, message }`, NOT a throw:
   *  - **cross-currency** claims need the still-stubbed `exchangeRate` domain (Slice 4 / PR5e);
   *  - claiming into a **mint the user has no account for** needs the auto-add + set-default UX
   *    (`userService.setDefaultAccount`, Slice 4) — pass a full `destinationAccount` instead.
   *
   * @param params.token - the encoded cashu token string.
   * @param params.destinationAccount - the account to claim into; omitted → master default
   *   resolution (the token's own mint = same-mint claim).
   * @returns a {@link ReceiveTokenResult} — started + destination, or failure + message.
   */
  async receiveToken(params: {
    token: string;
    destinationAccount?: Account;
  }): Promise<ReceiveTokenResult> {
    try {
      const user = await this.session.requireCurrentUser();
      const result = await this.claimFlow.claim({
        userId: user.id,
        encodedToken: params.token,
        destinationAccount: params.destinationAccount,
      });
      return { success: true, destinationAccount: result.destinationAccount };
    } catch (error) {
      if (error instanceof DomainError) {
        return { success: false, message: error.message };
      }
      // No Sentry/error-reporting seam in the framework-free SDK — master `captureException`s here;
      // we log with the cause (best-effort, like the service primitives) + return a generic message.
      const message = 'Unexpected error while claiming the token';
      console.error(message, { cause: error });
      return { success: false, message };
    }
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
