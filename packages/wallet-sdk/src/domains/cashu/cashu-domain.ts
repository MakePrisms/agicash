import type { Money } from '@agicash/money';
import { getDecodedToken } from '@cashu/cashu-ts';
import type { CashuDomain } from '../../domains';
import { DomainError, NotFoundError, SdkError } from '../../errors';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import { tokenToMoney } from '../../internal/lib/cashu';
import {
  buildLightningAddressFormatValidator,
  getInvoiceFromLud16,
  isLNURLError,
} from '../../internal/lib/lnurl';
import { ClaimCashuTokenService } from '../../internal/orchestrator/claim-cashu-token-service';
import { ReceiveCashuTokenQuoteService } from '../../internal/orchestrator/receive-cashu-token-quote-service';
import type { AccountRepository } from '../../internal/repositories/account-repository';
import { CashuReceiveQuoteRepository } from '../../internal/repositories/cashu-receive-quote-repository';
import { CashuReceiveSwapRepository } from '../../internal/repositories/cashu-receive-swap-repository';
import { CashuSendQuoteRepository } from '../../internal/repositories/cashu-send-quote-repository';
import { CashuSendSwapRepository } from '../../internal/repositories/cashu-send-swap-repository';
import { SparkReceiveQuoteRepository } from '../../internal/repositories/spark-receive-quote-repository';
import type { Account, CashuAccount } from '../../types/account';
import type {
  CashuReceiveQuote,
  CashuReceiveSwap,
  DestinationDetails,
} from '../../types/cashu';
import type { Ticker } from '../../types/exchange-rate';
import type { SparkReceiveQuote } from '../../types/spark';
import type { DomainContext } from '../context';
import { createExchangeRateDomain } from '../exchange-rate/exchange-rate-domain';
import { SparkReceiveQuoteService } from '../spark/spark-receive-quote-service';
import { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import { CashuReceiveSwapService } from './cashu-receive-swap-service';
import { CashuSendQuoteService } from './cashu-send-quote-service';
import { CashuSendSwapService } from './cashu-send-swap-service';
import { ReceiveCashuTokenService } from './receive-cashu-token-service';

/**
 * Build the cashu domain over the shared context + the account repository.
 *
 * All send + receive ops are implemented here. `send.executeQuote` is the
 * foreground send kick (the background loop drives completion); `receive.receiveToken`
 * decodes the token, resolves the source mint account, and delegates to the
 * cross-account / same-mint claim service.
 */
export function createCashuDomain(
  ctx: DomainContext,
  accountRepository: AccountRepository,
): CashuDomain {
  const {
    supabase,
    encryption,
    cashuCrypto,
    cashuWallets,
    cashuMintValidator,
  } = ctx.connections;

  const sendQuoteRepo = new CashuSendQuoteRepository(supabase, encryption);
  const sendSwapRepo = new CashuSendSwapRepository(supabase, encryption);
  const receiveQuoteRepo = new CashuReceiveQuoteRepository(
    supabase,
    encryption,
    accountRepository,
  );
  const receiveSwapRepo = new CashuReceiveSwapRepository(
    supabase,
    encryption,
    accountRepository,
  );

  const sendQuoteService = new CashuSendQuoteService(sendQuoteRepo);
  const receiveQuoteService = new CashuReceiveQuoteService(
    cashuCrypto,
    receiveQuoteRepo,
  );
  const receiveSwapService = new CashuReceiveSwapService(receiveSwapRepo);
  const sendSwapService = new CashuSendSwapService(
    sendSwapRepo,
    receiveSwapService,
  );

  const exchangeRate = createExchangeRateDomain();

  // Token-receive (cross-account melt-then-mint or same-mint swap). The spark
  // receive-quote service is rebuilt here (it is private to the spark factory).
  const sparkReceiveQuoteService = new SparkReceiveQuoteService(
    new SparkReceiveQuoteRepository(supabase, encryption),
  );
  const receiveCashuTokenService = new ReceiveCashuTokenService(
    cashuWallets,
    cashuMintValidator,
  );
  const claimCashuTokenService = new ClaimCashuTokenService({
    receiveSwapService,
    receiveCashuTokenQuoteService: new ReceiveCashuTokenQuoteService(
      receiveQuoteService,
      sparkReceiveQuoteService,
    ),
    getRate: (ticker: string) => exchangeRate.getRate(ticker as Ticker),
  });

  const isLightningAddress = buildLightningAddressFormatValidator({
    message: 'invalid',
    allowLocalhost: ctx.config.allowLocalhostLightningAddress ?? false,
  });

  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    return id;
  };

  const requireCashuAccount = async (id: string): Promise<CashuAccount> => {
    const account = await accountRepository.get(id);
    if (!account || account.type !== 'cashu') {
      throw new NotFoundError('Account not found', 'not_found');
    }
    return account;
  };

  /**
   * Resolves `destination` to a bolt11 invoice. A Lightning address is resolved
   * via LNURL-pay using `amount` (converted to BTC, since the resolver requires
   * msat); a bolt11 invoice is used directly. The cashu lightning-send path
   * always works against an amount-bearing invoice, so the melt quote derives
   * the BTC amount from the invoice itself — no exchange rate is needed there.
   */
  const resolveDestination = async (
    destination: string,
    amount?: Money,
  ): Promise<{
    paymentRequest: string;
    destinationDetails?: DestinationDetails;
  }> => {
    if (isLightningAddress(destination) !== true) {
      return { paymentRequest: destination };
    }

    if (!amount) {
      throw new DomainError(
        'Amount is required to send to a lightning address',
        'amount_required',
      );
    }

    const amountInBtc = (await exchangeRate.convert({
      amount,
      to: 'BTC',
    })) as Money<'BTC'>;

    const result = await getInvoiceFromLud16(destination, amountInBtc);
    if (isLNURLError(result)) {
      throw new DomainError(result.reason, 'lnurl_error');
    }

    return {
      paymentRequest: result.pr,
      destinationDetails: { sendType: 'LN_ADDRESS', lnAddress: destination },
    };
  };

  return {
    send: {
      async createLightningQuote({ account, destination, amount }) {
        const userId = await requireUserId();
        const { paymentRequest, destinationDetails } = await resolveDestination(
          destination,
          amount,
        );

        const lightningQuote = await sendQuoteService.getLightningQuote({
          account,
          paymentRequest,
          amount,
        });

        return sendQuoteService.createSendQuote({
          userId,
          account,
          sendQuote: {
            paymentRequest: lightningQuote.paymentRequest,
            amountRequested: lightningQuote.amountRequested,
            amountRequestedInBtc: lightningQuote.amountRequestedInBtc,
            meltQuote: lightningQuote.meltQuote,
          },
          destinationDetails,
        });
      },

      async createTokenQuote({ account, amount }) {
        const userId = await requireUserId();
        return sendSwapService.create({
          userId,
          account,
          amount,
          senderPaysFee: true,
        });
      },

      async executeQuote(quote) {
        const account = await requireCashuAccount(quote.accountId);
        const meltQuote = await account.wallet.checkMeltQuoteBolt11(
          quote.quoteId,
        );
        await sendQuoteService.initiateSend(account, quote, meltQuote);
        const updated = await sendQuoteService.markSendQuoteAsPending(quote);
        if (updated.state === 'PENDING') {
          ctx.emitter.emit('send:pending', {
            quoteId: updated.id,
            transactionId: updated.transactionId,
            protocol: 'cashu',
          });
        }
        return updated;
      },

      async failQuote(quote, reason) {
        const account = await requireCashuAccount(quote.accountId);
        await sendQuoteService.failSendQuote(account, quote, reason);
      },

      async reverse(swap) {
        const account = await requireCashuAccount(swap.accountId);
        await sendSwapService.reverse(swap, account);
        return (await sendSwapRepo.get(swap.id)) ?? swap;
      },

      async get(id) {
        return (await sendQuoteRepo.get(id)) ?? (await sendSwapRepo.get(id));
      },
    },

    receive: {
      async receiveToken({
        token,
        destinationAccount,
      }: {
        token: string;
        destinationAccount?: Account;
      }): Promise<CashuReceiveQuote | SparkReceiveQuote | CashuReceiveSwap> {
        const userId = await requireUserId();
        const decoded = getDecodedToken(token);
        const sourceAccount =
          await receiveCashuTokenService.buildAccountForMint(
            decoded.mint,
            tokenToMoney(decoded).currency,
          );
        return claimCashuTokenService.claimToken({
          userId,
          token: decoded,
          sourceAccount,
          destinationAccount: destinationAccount ?? sourceAccount,
        });
      },

      async createLightningQuote({ account, amount, purpose }) {
        const userId = await requireUserId();
        const lightningQuote = await receiveQuoteService.getLightningQuote({
          wallet: account.wallet,
          amount,
        });

        return receiveQuoteService.createReceiveQuote({
          userId,
          account,
          receiveType: 'LIGHTNING',
          lightningQuote,
          purpose: purpose ?? 'PAYMENT',
        });
      },

      async get(quoteId) {
        return receiveQuoteRepo.get(quoteId);
      },
    },
  };
}
