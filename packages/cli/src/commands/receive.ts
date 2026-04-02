import type { CashuAccount } from '@agicash/sdk/features/accounts/account';
import { areMintUrlsEqual } from '@agicash/sdk/lib/cashu/utils';
import { Money } from '@agicash/sdk/lib/money/money';
import {
  Mint,
  MintQuoteState,
  type Token,
  getDecodedToken,
  getTokenMetadata,
} from '@cashu/cashu-ts';
import type { ParsedArgs } from '../args';
import type { SdkContext } from '../sdk-context';

export type ReceiveResult = {
  action: string;
  quote?: {
    id: string;
    bolt11: string;
    amount: number;
    currency: string;
    account_id: string;
    mint_url: string;
    state: string;
    expiresAt?: string;
  };
  quotes?: Array<{
    id: string;
    amount: number;
    currency: string;
    account_id: string;
    state: string;
    expiresAt: string;
    createdAt: string;
  }>;
  minted?: { amount: number; currency: string; account_id: string };
  claimed?: {
    amount: number;
    fee: number;
    currency: string;
    account_id: string;
    mint_url: string;
  };
  checked?: {
    total: number;
    completed: number;
    pending: number;
    failed: number;
  };
  error?: string;
  code?: string;
};

export async function handleReceiveCommand(
  args: ParsedArgs,
  ctx: SdkContext,
  emitOutput?: (result: ReceiveResult) => void,
): Promise<ReceiveResult> {
  if (args.positional[0] === 'list') return handleListQuotes(ctx);
  if (args.flags['check-all']) return handleCheckAll(ctx);
  const checkQuoteId = args.flags.check as string;
  if (checkQuoteId) return handleCheckQuote(checkQuoteId, ctx);
  const input = args.positional[0] || (args.flags.amount as string);
  if (!input)
    return {
      action: 'error',
      error:
        'Usage: agicash receive <amount> (Lightning) or agicash receive <cashu-token>',
      code: 'MISSING_INPUT',
    };
  if (input.startsWith('cashuA') || input.startsWith('cashuB'))
    return handleReceiveToken(input, args, ctx);
  if (!/^\d+$/.test(input))
    return {
      action: 'error',
      error: `Invalid amount: ${input}. Must be a positive integer (whole number of sats).`,
      code: 'INVALID_AMOUNT',
    };
  const amount = Number.parseInt(input, 10);
  if (amount <= 0)
    return {
      action: 'error',
      error: `Invalid amount: ${input}. Must be greater than zero.`,
      code: 'INVALID_AMOUNT',
    };
  return handleReceiveLightning(amount, args, ctx, emitOutput);
}

async function handleReceiveLightning(
  amount: number,
  args: ParsedArgs,
  ctx: SdkContext,
  emitOutput?: (result: ReceiveResult) => void,
): Promise<ReceiveResult> {
  const account = await findCashuAccount(
    ctx,
    args.flags.account as string | undefined,
  );
  if (!account)
    return {
      action: 'error',
      error: args.flags.account
        ? `Account not found: ${args.flags.account}`
        : 'No cashu accounts configured. Run: agicash mint add <url>',
      code: 'NO_ACCOUNT',
    };
  try {
    const moneyAmount = new Money({
      amount,
      currency: account.currency,
      unit: account.currency === 'BTC' ? 'sat' : 'cent',
    });
    const lightningQuote = await ctx.cashuReceiveQuoteService.getLightningQuote(
      { wallet: account.wallet, amount: moneyAmount },
    );
    const quote = await ctx.cashuReceiveQuoteService.createReceiveQuote({
      userId: ctx.userId,
      account,
      lightningQuote,
      receiveType: 'LIGHTNING',
    });
    const result: ReceiveResult = {
      action: 'invoice',
      quote: {
        id: quote.id,
        bolt11: quote.paymentRequest,
        amount,
        currency: account.currency,
        account_id: account.id,
        mint_url: account.mintUrl,
        state: quote.state,
        expiresAt: quote.expiresAt,
      },
    };
    if (args.flags.wait) {
      emitOutput?.(result);
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const check = await account.wallet.checkMintQuoteBolt11(quote.quoteId);
        if (check.state === MintQuoteState.PAID) {
          const completed = await ctx.cashuReceiveQuoteService.completeReceive(
            account,
            quote,
          );
          return {
            action: 'minted',
            minted: {
              amount: completed.quote.amount.toNumber(
                account.currency === 'BTC' ? 'sat' : 'cent',
              ),
              currency: account.currency,
              account_id: account.id,
            },
          };
        }
        if (check.state !== MintQuoteState.UNPAID)
          return {
            action: 'error',
            error: `Unexpected quote state: ${String(check.state)}`,
            code: 'UNEXPECTED_STATE',
          };
      }
      return {
        action: 'error',
        error: 'Timed out waiting for payment (5 minutes).',
        code: 'TIMEOUT',
      };
    }
    return result;
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to create receive quote: ${err instanceof Error ? err.message : String(err)}`,
      code: 'RECEIVE_QUOTE_FAILED',
    };
  }
}

async function handleCheckQuote(
  quoteId: string,
  ctx: SdkContext,
): Promise<ReceiveResult> {
  try {
    const quote = await ctx.cashuReceiveQuoteRepo.get(quoteId);
    if (!quote)
      return {
        action: 'error',
        error: `Quote not found: ${quoteId}`,
        code: 'QUOTE_NOT_FOUND',
      };
    if (quote.state === 'COMPLETED')
      return {
        action: 'minted',
        minted: {
          amount: quote.amount.toNumber(
            quote.amount.currency === 'BTC' ? 'sat' : 'cent',
          ),
          currency: quote.amount.currency,
          account_id: quote.accountId,
        },
      };
    if (quote.state === 'EXPIRED' || quote.state === 'FAILED')
      return {
        action: 'error',
        error: `Quote is ${quote.state.toLowerCase()}`,
        code: `QUOTE_${quote.state}`,
      };
    const account = await ctx.accountRepo.get(quote.accountId);
    if (account.type !== 'cashu')
      return {
        action: 'error',
        error: 'Quote account is not a cashu account',
        code: 'INVALID_ACCOUNT',
      };
    const check = await account.wallet.checkMintQuoteBolt11(quote.quoteId);
    if (check.state === MintQuoteState.PAID || quote.state === 'PAID') {
      const completed = await ctx.cashuReceiveQuoteService.completeReceive(
        account,
        quote,
      );
      return {
        action: 'minted',
        minted: {
          amount: completed.quote.amount.toNumber(
            account.currency === 'BTC' ? 'sat' : 'cent',
          ),
          currency: account.currency,
          account_id: account.id,
        },
      };
    }
    return {
      action: 'pending',
      quote: {
        id: quote.id,
        bolt11: quote.paymentRequest,
        amount: quote.amount.toNumber(
          quote.amount.currency === 'BTC' ? 'sat' : 'cent',
        ),
        currency: quote.amount.currency,
        account_id: quote.accountId,
        mint_url: account.mintUrl,
        state: String(check.state),
        expiresAt: quote.expiresAt,
      },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to check quote: ${err instanceof Error ? err.message : String(err)}`,
      code: 'CHECK_FAILED',
    };
  }
}

async function handleReceiveToken(
  tokenString: string,
  args: ParsedArgs,
  ctx: SdkContext,
): Promise<ReceiveResult> {
  try {
    const tokenMeta = getTokenMetadata(tokenString);
    const mintUrl = tokenMeta.mint;
    if (!mintUrl)
      return {
        action: 'error',
        error: 'Cashu token does not specify a mint URL.',
        code: 'NO_MINT_IN_TOKEN',
      };
    const accountId = args.flags.account as string | undefined;
    const account = accountId
      ? await findCashuAccountById(ctx, accountId)
      : await findCashuAccountByMint(ctx, mintUrl);
    if (!account)
      return {
        action: 'error',
        error: accountId
          ? `Account not found: ${accountId}`
          : `No account for mint ${mintUrl}. Run: agicash mint add ${mintUrl}`,
        code: accountId ? 'NO_ACCOUNT' : 'NO_ACCOUNT_FOR_MINT',
      };
    const mint = new Mint(mintUrl);
    const keysets = await mint.getKeySets();
    const keysetIds = keysets.keysets.map((k) => k.id);
    const token: Token = getDecodedToken(tokenString, keysetIds);
    const { swap } = await ctx.cashuReceiveSwapService.create({
      userId: ctx.userId,
      token,
      account,
    });
    const { swap: completedSwap } =
      await ctx.cashuReceiveSwapService.completeSwap(account, swap);
    const unit = account.currency === 'BTC' ? 'sat' : 'cent';
    return {
      action: 'claimed',
      claimed: {
        amount: completedSwap.amountReceived.toNumber(unit),
        fee: completedSwap.feeAmount.toNumber(unit),
        currency: account.currency,
        account_id: account.id,
        mint_url: mintUrl,
      },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to receive token: ${err instanceof Error ? err.message : String(err)}`,
      code: 'RECEIVE_TOKEN_FAILED',
    };
  }
}

async function handleListQuotes(ctx: SdkContext): Promise<ReceiveResult> {
  try {
    const quotes = await ctx.cashuReceiveQuoteRepo.getPending(ctx.userId);
    return {
      action: 'list',
      quotes: quotes.map((q) => ({
        id: q.id,
        amount: q.amount.toNumber(q.amount.currency === 'BTC' ? 'sat' : 'cent'),
        currency: q.amount.currency,
        account_id: q.accountId,
        state: q.state,
        expiresAt: q.expiresAt,
        createdAt: q.createdAt,
      })),
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to list quotes: ${err instanceof Error ? err.message : String(err)}`,
      code: 'LIST_FAILED',
    };
  }
}

async function handleCheckAll(ctx: SdkContext): Promise<ReceiveResult> {
  try {
    const quotes = await ctx.cashuReceiveQuoteRepo.getPending(ctx.userId);
    const summary = {
      total: quotes.length,
      completed: 0,
      pending: 0,
      failed: 0,
    };
    if (quotes.length === 0) return { action: 'checked', checked: summary };
    const accountCache = new Map<string, CashuAccount>();
    for (const quote of quotes) {
      try {
        let account = accountCache.get(quote.accountId);
        if (!account) {
          const fetched = await ctx.accountRepo.get(quote.accountId);
          if (fetched.type !== 'cashu') {
            summary.failed++;
            continue;
          }
          account = fetched;
          accountCache.set(quote.accountId, account);
        }
        if (new Date(quote.expiresAt) < new Date()) {
          await ctx.cashuReceiveQuoteService.expire(quote);
          summary.failed++;
          continue;
        }
        if (quote.state === 'PAID') {
          await ctx.cashuReceiveQuoteService.completeReceive(account, quote);
          summary.completed++;
          continue;
        }
        const check = await account.wallet.checkMintQuoteBolt11(quote.quoteId);
        if (check.state === MintQuoteState.PAID) {
          await ctx.cashuReceiveQuoteService.completeReceive(account, quote);
          summary.completed++;
        } else if (check.state === MintQuoteState.UNPAID) {
          summary.pending++;
        } else {
          summary.failed++;
        }
      } catch {
        summary.pending++;
      }
    }
    return { action: 'checked', checked: summary };
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to check quotes: ${err instanceof Error ? err.message : String(err)}`,
      code: 'CHECK_ALL_FAILED',
    };
  }
}

async function findCashuAccount(
  ctx: SdkContext,
  accountId?: string,
): Promise<CashuAccount | null> {
  if (accountId) return findCashuAccountById(ctx, accountId);
  const accounts = await ctx.accountRepo.getAll(ctx.userId);
  return accounts.find((a): a is CashuAccount => a.type === 'cashu') ?? null;
}

async function findCashuAccountById(
  ctx: SdkContext,
  id: string,
): Promise<CashuAccount | null> {
  try {
    const account = await ctx.accountRepo.get(id);
    return account.type === 'cashu' ? account : null;
  } catch {
    return null;
  }
}

async function findCashuAccountByMint(
  ctx: SdkContext,
  mintUrl: string,
): Promise<CashuAccount | null> {
  const accounts = await ctx.accountRepo.getAll(ctx.userId);
  return (
    accounts.find(
      (a): a is CashuAccount =>
        a.type === 'cashu' && areMintUrlsEqual(a.mintUrl, mintUrl),
    ) ?? null
  );
}
