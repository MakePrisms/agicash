import type { Currency } from '@agicash/sdk/lib/money/index';
import { ExtendedMintInfo } from '@agicash/sdk/lib/cashu/protocol-extensions';
import { getMintPurpose } from '@agicash/sdk/lib/cashu/utils';
import { Mint } from '@cashu/cashu-ts';
import type { ParsedArgs } from '../args';
import type { SdkContext } from '../sdk-context';

export interface MintCommandResult {
  action: string;
  account?: {
    id: string;
    name: string;
    type: string;
    currency: string;
    mintUrl: string;
    isTestMint: boolean;
    createdAt: string;
  };
  accounts?: Array<{
    id: string;
    name: string;
    type: string;
    currency: string;
    mintUrl: string;
    isTestMint: boolean;
    createdAt: string;
  }>;
  error?: string;
  code?: string;
}

export async function handleMintCommand(
  args: ParsedArgs,
  ctx: SdkContext,
): Promise<MintCommandResult> {
  const subcommand = args.positional[0];

  switch (subcommand) {
    case 'add':
      return handleMintAdd(args, ctx);
    case 'list':
      return handleMintList(ctx);
    default:
      return {
        action: 'error',
        error: `Unknown mint subcommand: ${subcommand ?? '(none)'}. Use: mint add <url> or mint list`,
        code: 'UNKNOWN_SUBCOMMAND',
      };
  }
}

async function handleMintAdd(
  args: ParsedArgs,
  ctx: SdkContext,
): Promise<MintCommandResult> {
  const mintUrl = args.positional[1];
  if (!mintUrl) {
    return {
      action: 'error',
      error: 'Missing mint URL. Usage: agicash mint add <url>',
      code: 'MISSING_URL',
    };
  }

  // Normalize URL
  const normalizedUrl = mintUrl.replace(/\/+$/, '');

  // Validate URL format
  try {
    new URL(normalizedUrl);
  } catch {
    return {
      action: 'error',
      error: `Invalid URL: ${mintUrl}`,
      code: 'INVALID_URL',
    };
  }

  // Determine currency from flags (default BTC)
  const currency = ((args.flags.currency as string)?.toUpperCase() ||
    'BTC') as Currency;
  if (currency !== 'BTC' && currency !== 'USD') {
    return {
      action: 'error',
      error: `Invalid currency: ${currency}. Must be BTC or USD.`,
      code: 'INVALID_CURRENCY',
    };
  }

  // Determine name from flags or generate
  const name = (args.flags.name as string) || `${currency} Mint`;

  // Validate mint is reachable and supports the requested unit
  let mintInfo: ExtendedMintInfo;
  try {
    const mint = new Mint(normalizedUrl);
    const [infoResponse, keysetsResponse] = await Promise.all([
      mint.getInfo(),
      mint.getKeySets(),
    ]);
    mintInfo = new ExtendedMintInfo(infoResponse);
    const cashuUnit = currency === 'BTC' ? 'sat' : 'usd';
    const hasUnit = keysetsResponse.keysets.some(
      (ks: { unit: string; active: boolean }) =>
        ks.unit === cashuUnit && ks.active,
    );
    if (!hasUnit) {
      return {
        action: 'error',
        error: `Mint does not support ${currency}. Available units: ${[...new Set(keysetsResponse.keysets.map((k: { unit: string }) => k.unit))].join(', ')}`,
        code: 'UNSUPPORTED_UNIT',
      };
    }
  } catch (err) {
    return {
      action: 'error',
      error: `Could not reach mint at ${normalizedUrl}: ${err instanceof Error ? err.message : String(err)}`,
      code: 'MINT_UNREACHABLE',
    };
  }

  // Detect purpose from mint info (gift-card for closed-loop mints, transactional otherwise)
  const purpose = getMintPurpose(mintInfo);

  // Create account via SDK service (handles test mint check + DB insert)
  try {
    const account = await ctx.accountService.addCashuAccount({
      userId: ctx.userId,
      account: {
        name,
        type: 'cashu',
        currency,
        purpose,
        mintUrl: normalizedUrl,
      },
    });

    return {
      action: 'added',
      account: {
        id: account.id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        mintUrl: account.mintUrl,
        isTestMint: account.isTestMint,
        createdAt: account.createdAt,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to create account';
    // The SDK throws with "Account for this mint and currency already exists" on 409
    return {
      action: 'error',
      error: message,
      code: 'CREATE_FAILED',
    };
  }
}

async function handleMintList(ctx: SdkContext): Promise<MintCommandResult> {
  const accounts = await ctx.accountRepo.getAll(ctx.userId);
  const cashuAccounts = accounts.filter((a) => a.type === 'cashu');

  return {
    action: 'list',
    accounts: cashuAccounts.map((a) => {
      if (a.type !== 'cashu') throw new Error('unreachable');
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        mintUrl: a.mintUrl,
        isTestMint: a.isTestMint,
        createdAt: a.createdAt,
      };
    }),
  };
}
