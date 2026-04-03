import { toProof } from '@agicash/sdk/features/accounts/cashu-account';
import { getCashuProtocolUnit } from '@agicash/sdk/lib/cashu/utils';
import { Money } from '@agicash/sdk/lib/money/money';
import { getEncodedToken } from '@cashu/cashu-ts';
import type { ParsedArgs } from '../args';
import { resolveAccount } from '../resolve-account';
import type { SdkContext } from '../sdk-context';

export interface SendResult {
  action: string;
  qrData?: string;
  status?: string;
  token?: {
    encoded: string;
    amount: number;
    mint_url: string;
    account_id: string;
    proof_count: number;
  };
  error?: string;
  code?: string;
}

export async function handleSendCommand(
  args: ParsedArgs,
  ctx: SdkContext,
): Promise<SendResult> {
  const amountStr = args.positional[0] || (args.flags.amount as string);
  if (!amountStr) {
    return {
      action: 'error',
      error:
        'Usage: agicash send <amount> — creates a cashu token for the given amount in sats',
      code: 'MISSING_AMOUNT',
    };
  }
  if (!/^\d+$/.test(amountStr)) {
    return {
      action: 'error',
      error: `Invalid amount: ${amountStr}. Must be a positive integer (whole number of sats).`,
      code: 'INVALID_AMOUNT',
    };
  }
  const amount = Number.parseInt(amountStr, 10);
  if (amount <= 0) {
    return {
      action: 'error',
      error: `Invalid amount: ${amountStr}. Must be greater than zero.`,
      code: 'INVALID_AMOUNT',
    };
  }

  const account = await resolveAccount(ctx, {
    accountId: args.flags.account as string | undefined,
    preferType: 'cashu',
  });
  if (!account) {
    return {
      action: 'error',
      error: args.flags.account
        ? `Account not found: ${args.flags.account}`
        : 'No cashu accounts configured. Run: agicash mint add <url> or agicash account list',
      code: 'NO_ACCOUNT',
    };
  }
  if (account.type !== 'cashu') {
    return {
      action: 'error',
      error:
        "Send creates ecash tokens which requires a cashu account. Use 'pay' for Lightning payments.",
      code: 'WRONG_ACCOUNT_TYPE',
    };
  }

  const sendAmount = new Money({
    amount,
    currency: account.currency,
    unit: account.currency === 'BTC' ? 'sat' : 'cent',
  });

  try {
    let swap = await ctx.cashuSendSwapService.create({
      userId: ctx.userId,
      account,
      amount: sendAmount,
      senderPaysFee: true,
    });

    if (swap.state === 'DRAFT') {
      await ctx.cashuSendSwapService.swapForProofsToSend({ account, swap });
      const updated = await ctx.cashuSendSwapRepo.get(swap.id);
      if (!updated) {
        return {
          action: 'error',
          error: 'Failed to retrieve swap after proof swap.',
          code: 'SWAP_FETCH_FAILED',
        };
      }
      swap = updated;
    }

    if (swap.state !== 'PENDING') {
      return {
        action: 'error',
        error: `Unexpected swap state: ${swap.state}`,
        code: 'UNEXPECTED_STATE',
      };
    }

    const protocolUnit = getCashuProtocolUnit(account.currency);
    const encoded = getEncodedToken({
      mint: account.mintUrl,
      proofs: swap.proofsToSend.map((p) => toProof(p)),
      unit: protocolUnit,
    });

    const tokenAmount = swap.proofsToSend.reduce((sum, p) => sum + p.amount, 0);

    return {
      action: 'created',
      qrData: encoded,
      status: 'pending_completion',
      token: {
        encoded,
        amount: tokenAmount,
        mint_url: account.mintUrl,
        account_id: account.id,
        proof_count: swap.proofsToSend.length,
      },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to create ecash token: ${err instanceof Error ? err.message : String(err)}`,
      code: 'SEND_FAILED',
    };
  }
}

