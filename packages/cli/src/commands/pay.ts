import {
  Money,
  getInvoiceFromLud16,
  isLNURLError,
} from '@agicash/sdk';
import type {
  CashuAccount,
  SparkAccount,
} from '@agicash/sdk/features/accounts/account';
import type { ParsedArgs } from '../args';
import { resolveAccount } from '../resolve-account';
import type { SdkContext } from '../sdk-context';

export interface PayResult {
  action: string;
  payment?: {
    quote_id: string;
    bolt11: string;
    amount: number;
    fee_reserve?: number;
    fee_estimate?: number;
    currency: string;
    account_id: string;
    account_name: string;
    account_type: 'cashu' | 'spark';
    mint_url?: string;
    state: string;
  };
  error?: string;
  code?: string;
}

export async function handlePayCommand(
  args: ParsedArgs,
  ctx: SdkContext,
): Promise<PayResult> {
  let bolt11 = (args.flags.bolt11 as string) || args.positional[0];
  if (!bolt11) {
    return {
      action: 'error',
      error:
        'Missing invoice. Usage: agicash pay --bolt11 <invoice> or agicash pay <invoice>',
      code: 'MISSING_INVOICE',
    };
  }

  // Check if input is a Lightning address (user@domain)
  if (bolt11.includes('@') && bolt11.includes('.')) {
    const amount = args.flags.amount as string | undefined;
    if (!amount) {
      return {
        action: 'error',
        error: 'Lightning address requires --amount. Usage: agicash pay user@domain --amount 100',
        code: 'MISSING_AMOUNT',
      };
    }
    try {
      const amountSats = parseInt(amount, 10);
      const amountMoney = new Money<'BTC'>({ amount: amountSats, currency: 'BTC', unit: 'sat' });
      const result = await getInvoiceFromLud16(bolt11, amountMoney);
      if (isLNURLError(result)) {
        return {
          action: 'error',
          error: `Failed to resolve Lightning address: ${result.reason}`,
          code: 'LN_ADDRESS_RESOLVE_FAILED',
        };
      }
      bolt11 = result.pr;
    } catch (err) {
      return {
        action: 'error',
        error: `Failed to resolve Lightning address: ${err instanceof Error ? err.message : String(err)}`,
        code: 'LN_ADDRESS_RESOLVE_FAILED',
      };
    }
  }

  if (!bolt11.startsWith('ln')) {
    return {
      action: 'error',
      error: 'Invalid Lightning invoice. Must start with "ln".',
      code: 'INVALID_INVOICE',
    };
  }

  const account = await resolveAccount(ctx, {
    accountId: args.flags.account as string | undefined,
    preferType: 'spark',
    requireCanSendLightning: true,
  });
  if (!account) {
    return {
      action: 'error',
      error: args.flags.account
        ? `Account not found: ${args.flags.account}`
        : 'No accounts that can send Lightning payments. Run: agicash mint add <url> or agicash account list',
      code: 'NO_ACCOUNT',
    };
  }

  if (account.type === 'spark') {
    return handleSparkPay(bolt11, account, ctx);
  }

  return handleCashuPay(bolt11, account as CashuAccount, ctx);
}

async function handleSparkPay(
  bolt11: string,
  account: SparkAccount,
  ctx: SdkContext,
): Promise<PayResult> {
  try {
    const quote = await ctx.sparkSendQuoteService.getLightningSendQuote({
      account,
      paymentRequest: bolt11,
    });
    const sendQuote = await ctx.sparkSendQuoteService.createSendQuote({
      userId: ctx.userId,
      account,
      quote,
    });
    // Initiate immediately -- the task processor handles completion
    await ctx.sparkSendQuoteService.initiateSend({ account, sendQuote });

    return {
      action: 'created',
      payment: {
        quote_id: sendQuote.id,
        bolt11,
        amount: quote.amountRequestedInBtc.toNumber('sat'),
        fee_estimate: quote.estimatedLightningFee.toNumber('sat'),
        currency: account.currency,
        account_id: account.id,
        account_name: account.name,
        account_type: 'spark',
        state: 'pending',
      },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Payment failed: ${err instanceof Error ? err.message : String(err)}`,
      code: 'PAY_FAILED',
    };
  }
}

async function handleCashuPay(
  bolt11: string,
  account: CashuAccount,
  ctx: SdkContext,
): Promise<PayResult> {
  try {
    const lightningQuote = await ctx.cashuSendQuoteService.getLightningQuote({
      account,
      paymentRequest: bolt11,
    });
    const sendQuote = await ctx.cashuSendQuoteService.createSendQuote({
      userId: ctx.userId,
      account,
      sendQuote: {
        paymentRequest: lightningQuote.paymentRequest,
        amountRequested: lightningQuote.amountRequested,
        amountRequestedInBtc: lightningQuote.amountRequestedInBtc,
        meltQuote: lightningQuote.meltQuote,
      },
    });
    return {
      action: 'created',
      payment: {
        quote_id: sendQuote.id,
        bolt11,
        amount: lightningQuote.meltQuote.amount,
        fee_reserve: lightningQuote.meltQuote.fee_reserve,
        currency: account.currency,
        account_id: account.id,
        account_name: account.name,
        account_type: 'cashu',
        mint_url: account.mintUrl,
        state: 'pending',
      },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Payment failed: ${err instanceof Error ? err.message : String(err)}`,
      code: 'PAY_FAILED',
    };
  }
}

