import type { CashuAccount } from '@agicash/sdk/features/accounts/account';
import type { ParsedArgs } from '../args';
import type { SdkContext } from '../sdk-context';

export interface PayResult {
  action: string;
  payment?: {
    quote_id: string;
    bolt11: string;
    amount: number;
    fee_reserve: number;
    currency: string;
    account_id: string;
    account_name: string;
    mint_url: string;
    state: string;
  };
  error?: string;
  code?: string;
}

export async function handlePayCommand(
  args: ParsedArgs,
  ctx: SdkContext,
): Promise<PayResult> {
  const bolt11 = (args.flags.bolt11 as string) || args.positional[0];
  if (!bolt11) {
    return {
      action: 'error',
      error:
        'Missing invoice. Usage: agicash pay --bolt11 <invoice> or agicash pay <invoice>',
      code: 'MISSING_INVOICE',
    };
  }
  if (!bolt11.startsWith('ln')) {
    return {
      action: 'error',
      error: 'Invalid Lightning invoice. Must start with "ln".',
      code: 'INVALID_INVOICE',
    };
  }

  const account = await findCashuAccount(
    ctx,
    args.flags.account as string | undefined,
  );
  if (!account) {
    return {
      action: 'error',
      error: args.flags.account
        ? `Account not found: ${args.flags.account}`
        : 'No cashu accounts configured. Run: agicash mint add <url>',
      code: 'NO_ACCOUNT',
    };
  }

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

async function findCashuAccount(
  ctx: SdkContext,
  accountId?: string,
): Promise<CashuAccount | undefined> {
  if (accountId) {
    const account = await ctx.accountRepo.get(accountId);
    return account.type === 'cashu' ? account : undefined;
  }
  const accounts = await ctx.accountRepo.getAll(ctx.userId);
  return accounts.find((a): a is CashuAccount => a.type === 'cashu');
}
