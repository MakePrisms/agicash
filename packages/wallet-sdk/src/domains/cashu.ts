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
 * flow (same-mint receive swap + the cross-account melt-then-mint path) through the orchestrator.
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
   * Claim a cashu token (PR5d). Decodes the token, resolves source/destination accounts, and
   * routes the claim through the orchestrator:
   *  - **same-mint** (default — into the token's own mint): a {@link CashuReceiveSwapService} swap
   *    driven to COMPLETED by the orchestrator. A same-mint claim yields an internal swap, NOT a
   *    quote, so it resolves to a quote-less in-progress receive (track via `receive:completed`
   *    keyed by its transaction id) — see the divergence note below;
   *  - **cross-account** (`destinationAccount` is a different cashu mint, or spark): the
   *    melt-then-mint path, returning the destination {@link CashuReceiveQuote} /
   *    {@link SparkReceiveQuote} (the cross-account token→spark path the contract names).
   *
   * Resolves on KICK-OFF; completion arrives via `receive:completed` / `receive:failed`.
   *
   * DIVERGENCE / DEFERRED (vs master `ClaimCashuTokenService`, documented for review — folds in
   * with the Slice-4 exchangeRate + user-service work, see {@link ClaimCashuTokenFlow}):
   *  - cross-account is supported for the SAME currency only (a cross-currency claim needs the
   *    still-stubbed `exchangeRate` domain → `DomainError`);
   *  - claiming into a mint the user has no account for needs the auto-add + set-default UX
   *    (`userService.setDefaultAccount`, Slice 4) — pass a full `destinationAccount` instead;
   *  - the SAME-MINT path returns the contract's quote union as a best-effort: master's same-mint
   *    claim is a swap with no quote, so for that case the method currently returns the IN-PROGRESS
   *    receive without a quote body is not representable in the locked return type — the same-mint
   *    branch therefore throws a typed `DomainError` directing same-mint claims through the
   *    (already-built + tested) swap primitive until the return type is widened (PR5e). The
   *    cross-account branch — the one the contract's cross-protocol note targets — is fully wired.
   *
   * @param params.token - the encoded cashu token string.
   * @param params.destinationAccount - the account to claim into (cross-account).
   * @returns the destination receive quote (cross-account).
   */
  async receiveToken(params: {
    token: string;
    destinationAccount?: Account;
  }): Promise<CashuReceiveQuote | SparkReceiveQuote> {
    const user = await this.session.requireCurrentUser();
    const result = await this.claimFlow.claim({
      userId: user.id,
      encodedToken: params.token,
      destinationAccount: params.destinationAccount,
    });
    if (result.kind === 'same-mint') {
      // A same-mint claim produces an internal receive SWAP, which the locked `receiveToken` return
      // type (a receive QUOTE) cannot carry. The flow performs NO side effect for this case, so this
      // is a clean boundary, not a half-done claim: surface it explicitly. Widening the return type
      // to carry the (already-built + tested) same-mint swap is the PR5e follow-up.
      throw new DomainError(
        'Claiming a token back into its own mint yields a receive swap that the locked receiveToken return type (a receive quote) cannot carry; pass a cross-account destinationAccount (different mint, or spark) to claim, or use the receive-swap primitive directly (PR5e widens the return type).',
      );
    }
    return result.quote;
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
