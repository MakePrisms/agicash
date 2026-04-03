import type {
  CashuAccount,
  SparkAccount,
} from '@agicash/sdk/features/accounts/account';
import { AccountService } from '@agicash/sdk/features/accounts/account-service';
import { ReceiveCashuTokenService } from '@agicash/sdk/features/receive/receive-cashu-token-service';
import { getLightningQuote as getSparkLightningQuote } from '@agicash/sdk/features/receive/spark-receive-quote-core';
import { sumProofs } from '@agicash/sdk/lib/cashu/proof';
import { getUnspentProofsFromToken } from '@agicash/sdk/lib/cashu/token';
import { Money } from '@agicash/sdk/lib/money/money';
import {
  Mint,
  MintQuoteState,
  type Token,
  getDecodedToken,
  getTokenMetadata,
} from '@cashu/cashu-ts';
import type { ParsedArgs } from '../args';
import { resolveAccount } from '../resolve-account';
import type { SdkContext } from '../sdk-context';

export type ReceiveResult = {
  action: string;
  qrData?: string;
  quote?: {
    id: string;
    bolt11: string;
    amount: number;
    currency: string;
    account_id: string;
    account_type: 'cashu' | 'spark';
    mint_url?: string;
    state: string;
    expiresAt?: string;
  };
  quotes?: Array<{
    id: string;
    amount: number;
    currency: string;
    account_id: string;
    account_type: 'cashu' | 'spark';
    state: string;
    expiresAt: string;
    createdAt: string;
  }>;
  minted?: { amount: number; currency: string; account_id: string };
  swap?: {
    tokenHash: string;
    amount: number;
    fee: number;
    currency: string;
    account_id: string;
    mint_url: string;
    state: string;
  };
  selectable_accounts?: Array<{
    id: string;
    name: string;
    type: string;
    currency: string;
    is_default: boolean;
    can_receive: boolean;
  }>;
  default_receive_account_id?: string | null;
  checked?: {
    total: number;
    completed: number;
    pending: number;
    failed: number;
  };
  inspect_proofs?: {
    proof_count_total: number;
    proof_count_unspent: number;
    amount_claimable: number;
    already_spent: boolean;
  };
  error?: string;
  code?: string;
};

export async function handleReceiveCommand(
  args: ParsedArgs,
  ctx: SdkContext,
): Promise<ReceiveResult> {
  if (args.positional[0] === 'list') return handleListQuotes(ctx);
  if (args.flags['check-all']) return handleCheckAll(ctx);
  const checkQuoteId = args.flags.check as string;
  if (checkQuoteId) return handleCheckQuote(checkQuoteId, ctx);

  const inspectToken = args.flags.inspect as string | undefined;
  if (inspectToken) return handleInspectToken(inspectToken, ctx);

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
  return handleReceiveLightning(amount, args, ctx);
}

async function handleReceiveLightning(
  amount: number,
  args: ParsedArgs,
  ctx: SdkContext,
): Promise<ReceiveResult> {
  const account = await resolveAccount(ctx, {
    accountId: args.flags.account as string | undefined,
    requireCanReceiveLightning: true,
  });
  if (!account)
    return {
      action: 'error',
      error: args.flags.account
        ? `Account not found: ${args.flags.account}`
        : 'No accounts that can receive Lightning. Run: agicash account list',
      code: 'NO_ACCOUNT',
    };

  if (account.type === 'spark') {
    return handleSparkReceiveLightning(amount, account, ctx);
  }
  return handleCashuReceiveLightning(amount, account, ctx);
}

async function handleSparkReceiveLightning(
  amount: number,
  account: SparkAccount,
  ctx: SdkContext,
): Promise<ReceiveResult> {
  try {
    const moneyAmount = new Money({
      amount,
      currency: account.currency,
      unit: account.currency === 'BTC' ? 'sat' : 'cent',
    });
    const lightningQuote = await getSparkLightningQuote({
      wallet: account.wallet,
      amount: moneyAmount,
    });
    const quote = await ctx.sparkReceiveQuoteService.createReceiveQuote({
      userId: ctx.userId,
      account,
      lightningQuote,
      receiveType: 'LIGHTNING',
    });
    return {
      action: 'invoice',
      qrData: quote.paymentRequest,
      quote: {
        id: quote.id,
        bolt11: quote.paymentRequest,
        amount,
        currency: account.currency,
        account_id: account.id,
        account_type: 'spark',
        state: quote.state,
        expiresAt: quote.expiresAt,
      },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to create spark receive quote: ${err instanceof Error ? err.message : String(err)}`,
      code: 'RECEIVE_QUOTE_FAILED',
    };
  }
}

async function handleCashuReceiveLightning(
  amount: number,
  account: CashuAccount,
  ctx: SdkContext,
): Promise<ReceiveResult> {
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
    return {
      action: 'invoice',
      qrData: quote.paymentRequest,
      quote: {
        id: quote.id,
        bolt11: quote.paymentRequest,
        amount,
        currency: account.currency,
        account_id: account.id,
        account_type: 'cashu',
        mint_url: account.mintUrl,
        state: quote.state,
        expiresAt: quote.expiresAt,
      },
    };
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
    // Try cashu repo first
    const cashuQuote = await ctx.cashuReceiveQuoteRepo.get(quoteId);
    if (cashuQuote) {
      return handleCheckCashuQuote(cashuQuote, ctx);
    }

    // Try spark repo
    const sparkQuote = await ctx.sparkReceiveQuoteRepo.get(quoteId);
    if (sparkQuote) {
      return handleCheckSparkQuote(sparkQuote);
    }

    return {
      action: 'error',
      error: `Quote not found: ${quoteId}`,
      code: 'QUOTE_NOT_FOUND',
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to check quote: ${err instanceof Error ? err.message : String(err)}`,
      code: 'CHECK_FAILED',
    };
  }
}

async function handleCheckCashuQuote(
  quote: { id: string; state: string; amount: Money; accountId: string; quoteId: string; paymentRequest: string; expiresAt: string },
  ctx: SdkContext,
): Promise<ReceiveResult> {
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
  const mintState = String(check.state);
  const resolvedState =
    check.state === MintQuoteState.PAID || quote.state === 'PAID'
      ? 'PAID'
      : mintState;
  return {
    action: resolvedState === 'PAID' ? 'paid' : 'pending',
    quote: {
      id: quote.id,
      bolt11: quote.paymentRequest,
      amount: quote.amount.toNumber(
        quote.amount.currency === 'BTC' ? 'sat' : 'cent',
      ),
      currency: quote.amount.currency,
      account_id: quote.accountId,
      account_type: 'cashu',
      mint_url: account.mintUrl,
      state: resolvedState,
      expiresAt: quote.expiresAt,
    },
  };
}

function handleCheckSparkQuote(
  quote: { id: string; state: string; amount: Money; accountId: string; paymentRequest: string; expiresAt: string },
): ReceiveResult {
  if (quote.state === 'PAID')
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
  // Spark quotes are completed by the task processor; just return current state
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
      account_type: 'spark',
      state: quote.state,
      expiresAt: quote.expiresAt,
    },
  };
}

async function handleInspectToken(
  tokenString: string,
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

    const mint = new Mint(mintUrl);
    const keysets = await mint.getKeySets();
    const keysetIds = keysets.keysets.map((k) => k.id);
    const token: Token = getDecodedToken(tokenString, keysetIds);

    const user = await ctx.wallet.queryClient.fetchQuery(
      ctx.wallet.queries.userQuery(),
    );
    const accounts = await ctx.accountRepo.getAll(ctx.userId);
    const extended = AccountService.getExtendedAccounts(user, accounts);

    const { sourceAccount, possibleDestinationAccounts } =
      await ctx.receiveCashuTokenService.getSourceAndDestinationAccounts(
        token,
        extended,
      );

    const defaultReceiveAccount =
      ReceiveCashuTokenService.getDefaultReceiveAccount(
        sourceAccount,
        possibleDestinationAccounts,
      );

    // Check proof states against the mint
    let inspectProofs: ReceiveResult['inspect_proofs'];
    try {
      const unspentProofs = await getUnspentProofsFromToken(token);
      inspectProofs = {
        proof_count_total: token.proofs.length,
        proof_count_unspent: unspentProofs.length,
        amount_claimable: sumProofs(unspentProofs),
        already_spent: unspentProofs.length === 0,
      };
    } catch {
      // If mint is unreachable, omit proof state info rather than failing
      inspectProofs = undefined;
    }

    return {
      action: 'inspect',
      swap: {
        tokenHash: '',
        amount: tokenMeta.amount,
        fee: 0,
        currency: tokenMeta.unit ?? 'sat',
        account_id: '',
        mint_url: mintUrl,
        state: 'inspect',
      },
      selectable_accounts: possibleDestinationAccounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        is_default: a.isDefault,
        can_receive: a.canReceive,
      })),
      default_receive_account_id: defaultReceiveAccount?.id ?? null,
      inspect_proofs: inspectProofs,
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to inspect token: ${err instanceof Error ? err.message : String(err)}`,
      code: 'INSPECT_TOKEN_FAILED',
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

    // Decode token for getSourceAndDestinationAccounts
    const mint = new Mint(mintUrl);
    const keysets = await mint.getKeySets();
    const keysetIds = keysets.keysets.map((k) => k.id);
    let token: Token = getDecodedToken(tokenString, keysetIds);

    // Check proof states against the mint — fail early if all proofs are spent
    try {
      const unspentProofs = await getUnspentProofsFromToken(token);
      if (unspentProofs.length === 0) {
        return {
          action: 'error',
          error: 'This ecash has already been spent',
          code: 'TOKEN_ALREADY_SPENT',
        };
      }
      if (unspentProofs.length < token.proofs.length) {
        // Partial spend: continue with only the unspent proofs
        token = { ...token, proofs: unspentProofs };
      }
    } catch {
      // Mint unreachable — log warning but still attempt the receive
      console.warn(
        `Warning: could not check proof states against ${mintUrl} — proceeding anyway`,
      );
    }

    // Fetch user + accounts to determine selectable destinations
    const user = await ctx.wallet.queryClient.fetchQuery(
      ctx.wallet.queries.userQuery(),
    );
    const accounts = await ctx.accountRepo.getAll(ctx.userId);
    const extended = AccountService.getExtendedAccounts(user, accounts);

    const { sourceAccount, possibleDestinationAccounts } =
      await ctx.receiveCashuTokenService.getSourceAndDestinationAccounts(
        token,
        extended,
      );

    // Determine the destination account
    const accountId = args.flags.account as string | undefined;
    const destinationAccount = accountId
      ? possibleDestinationAccounts.find((a) => a.id === accountId) ?? null
      : ReceiveCashuTokenService.getDefaultReceiveAccount(
          sourceAccount,
          possibleDestinationAccounts,
        );

    if (!destinationAccount) {
      return {
        action: 'error',
        error: accountId
          ? `Account ${accountId} cannot receive this token. Run: agicash decode ${tokenString} to see selectable accounts.`
          : `No account can receive this token. Run: agicash mint add ${mintUrl}`,
        code: accountId ? 'INVALID_ACCOUNT' : 'NO_ACCOUNT_FOR_MINT',
        selectable_accounts: possibleDestinationAccounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          currency: a.currency,
          is_default: a.isDefault,
          can_receive: a.canReceive,
        })),
      };
    }

    // Same-mint cashu claim: use existing swap flow
    if (
      destinationAccount.type === 'cashu' &&
      sourceAccount.type === 'cashu' &&
      destinationAccount.id === sourceAccount.id
    ) {
      const { swap } = await ctx.cashuReceiveSwapService.create({
        userId: ctx.userId,
        token,
        account: destinationAccount,
      });
      const unit = destinationAccount.currency === 'BTC' ? 'sat' : 'cent';
      return {
        action: 'created',
        swap: {
          tokenHash: swap.tokenHash,
          amount: swap.amountReceived.toNumber(unit),
          fee: swap.feeAmount.toNumber(unit),
          currency: destinationAccount.currency,
          account_id: destinationAccount.id,
          mint_url: mintUrl,
          state: swap.state,
        },
      };
    }

    // Cross-account receive (different mint or different account type like spark)
    // TODO: Implement cross-account token receive. This requires:
    // 1. Melt the token on the source mint to pay a Lightning invoice
    // 2. Mint new tokens on the destination (or receive via spark)
    // This is what ClaimCashuTokenService.claimToken() does in the web app.
    // For now, if destination is the source cashu account, do the direct swap.
    // Otherwise, fall back to direct swap on source if it can receive.
    if (sourceAccount.canReceive && !sourceAccount.isUnknown) {
      const { swap } = await ctx.cashuReceiveSwapService.create({
        userId: ctx.userId,
        token,
        account: sourceAccount,
      });
      const unit = sourceAccount.currency === 'BTC' ? 'sat' : 'cent';
      return {
        action: 'created',
        swap: {
          tokenHash: swap.tokenHash,
          amount: swap.amountReceived.toNumber(unit),
          fee: swap.feeAmount.toNumber(unit),
          currency: sourceAccount.currency,
          account_id: sourceAccount.id,
          mint_url: mintUrl,
          state: swap.state,
        },
        selectable_accounts: possibleDestinationAccounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          currency: a.currency,
          is_default: a.isDefault,
          can_receive: a.canReceive,
        })),
        default_receive_account_id: destinationAccount.id,
      };
    }

    return {
      action: 'error',
      error: `Cross-account token receive not yet implemented. The token is from ${mintUrl} but the selected destination is a different account. Use --account to pick a cashu account on the same mint, or add the mint: agicash mint add ${mintUrl}`,
      code: 'CROSS_ACCOUNT_NOT_IMPLEMENTED',
      selectable_accounts: possibleDestinationAccounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        is_default: a.isDefault,
        can_receive: a.canReceive,
      })),
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
    const [cashuQuotes, sparkQuotes] = await Promise.all([
      ctx.cashuReceiveQuoteRepo.getPending(ctx.userId),
      ctx.sparkReceiveQuoteRepo.getPending(ctx.userId),
    ]);
    const allQuotes = [
      ...cashuQuotes.map((q) => ({
        id: q.id,
        amount: q.amount.toNumber(q.amount.currency === 'BTC' ? 'sat' : 'cent'),
        currency: q.amount.currency,
        account_id: q.accountId,
        account_type: 'cashu' as const,
        state: q.state,
        expiresAt: q.expiresAt,
        createdAt: q.createdAt,
      })),
      ...sparkQuotes.map((q) => ({
        id: q.id,
        amount: q.amount.toNumber(q.amount.currency === 'BTC' ? 'sat' : 'cent'),
        currency: q.amount.currency,
        account_id: q.accountId,
        account_type: 'spark' as const,
        state: q.state,
        expiresAt: q.expiresAt,
        createdAt: q.createdAt,
      })),
    ];
    return {
      action: 'list',
      quotes: allQuotes,
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
    const [cashuQuotes, sparkQuotes] = await Promise.all([
      ctx.cashuReceiveQuoteRepo.getPending(ctx.userId),
      ctx.sparkReceiveQuoteRepo.getPending(ctx.userId),
    ]);
    const summary = {
      total: cashuQuotes.length + sparkQuotes.length,
      completed: 0,
      pending: 0,
      failed: 0,
    };
    if (summary.total === 0) return { action: 'checked', checked: summary };

    // Check cashu quotes against mints
    const accountCache = new Map<string, CashuAccount>();
    for (const quote of cashuQuotes) {
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
          summary.failed++;
          continue;
        }
        if (quote.state === 'PAID') {
          summary.completed++;
          continue;
        }
        const check = await account.wallet.checkMintQuoteBolt11(quote.quoteId);
        if (check.state === MintQuoteState.PAID) {
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

    // Spark quotes: just report current state (task processor handles completion)
    for (const quote of sparkQuotes) {
      if (quote.state === 'PAID') {
        summary.completed++;
      } else if (quote.state === 'EXPIRED' || quote.state === 'FAILED') {
        summary.failed++;
      } else {
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

