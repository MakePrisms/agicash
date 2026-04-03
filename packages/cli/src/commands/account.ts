import type { Account } from '@agicash/sdk/features/accounts/account';
import {
  canReceiveFromLightning,
  canSendToLightning,
  getAccountBalance,
} from '@agicash/sdk/features/accounts/account';
import { AccountService } from '@agicash/sdk/features/accounts/account-service';
import { getCashuUnit } from '@agicash/sdk/lib/cashu/utils';
import { UserService, WriteUserRepository } from '@agicash/sdk';
import type { ParsedArgs } from '../args';
import type { SdkContext } from '../sdk-context';
import { getSupabaseClient } from '../supabase-client';

export interface AccountCommandResult {
  action: string;
  accounts?: AccountInfo[];
  account?: AccountInfo;
  error?: string;
  code?: string;
}

interface AccountInfo {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
  unit: string;
  is_default: boolean;
  can_send_lightning: boolean;
  can_receive_lightning: boolean;
  mint_url?: string;
  purpose: string;
  is_test_mint?: boolean;
  is_online: boolean;
  created_at: string;
  // spark-specific
  available_balance?: number;
  network?: string;
  // cashu-specific
  proof_count?: number;
  keyset_count?: number;
}

export async function handleAccountCommand(
  args: ParsedArgs,
  ctx: SdkContext,
): Promise<AccountCommandResult> {
  const subcommand = args.positional[0];

  switch (subcommand) {
    case 'list':
      return handleAccountList(ctx);
    case 'default':
      return handleAccountDefault(args, ctx);
    case 'info':
      return handleAccountInfo(args, ctx);
    default:
      return {
        action: 'error',
        error: `Unknown account subcommand: ${subcommand ?? '(none)'}. Use: account list, account default <id>, or account info <id>`,
        code: 'UNKNOWN_SUBCOMMAND',
      };
  }
}

function buildAccountInfo(
  account: Account,
  isDefault: boolean,
): AccountInfo {
  const balance = getAccountBalance(account);
  const unit = getCashuUnit(account.currency);
  const balanceNumber = balance?.toNumber(unit) ?? 0;

  const info: AccountInfo = {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    balance: balanceNumber,
    unit: unit === 'sat' ? 'sats' : 'cents',
    is_default: isDefault,
    can_send_lightning: canSendToLightning(account),
    can_receive_lightning: canReceiveFromLightning(account),
    purpose: account.purpose,
    is_online: account.isOnline,
    created_at: account.createdAt,
  };

  if (account.type === 'cashu') {
    info.mint_url = account.mintUrl;
    info.is_test_mint = account.isTestMint;
    info.proof_count = account.proofs.length;
    info.keyset_count = Object.keys(account.keysetCounters).length;
  }

  if (account.type === 'spark') {
    info.available_balance =
      account.availableBalance?.toNumber(unit) ?? undefined;
    info.network = account.network;
  }

  return info;
}

async function handleAccountList(
  ctx: SdkContext,
): Promise<AccountCommandResult> {
  const user = await ctx.wallet.queryClient.fetchQuery(
    ctx.wallet.queries.userQuery(),
  );
  const accounts = await ctx.accountRepo.getAll(ctx.userId);
  const extended = AccountService.getExtendedAccounts(user, accounts);

  const accountInfos: AccountInfo[] = extended.map((account) =>
    buildAccountInfo(account, account.isDefault),
  );

  return {
    action: 'list',
    accounts: accountInfos,
  };
}

async function handleAccountDefault(
  args: ParsedArgs,
  ctx: SdkContext,
): Promise<AccountCommandResult> {
  const accountId = args.positional[1];
  if (!accountId) {
    return {
      action: 'error',
      error: 'Missing account ID. Usage: agicash account default <id>',
      code: 'MISSING_ACCOUNT_ID',
    };
  }

  let account: Account;
  try {
    account = await ctx.accountRepo.get(accountId);
  } catch {
    return {
      action: 'error',
      error: `Account not found: ${accountId}`,
      code: 'ACCOUNT_NOT_FOUND',
    };
  }

  const user = await ctx.wallet.queryClient.fetchQuery(
    ctx.wallet.queries.userQuery(),
  );

  const db = getSupabaseClient();
  const writeUserRepo = new WriteUserRepository(db, ctx.accountRepo);
  const userService = new UserService(writeUserRepo);

  try {
    const updatedUser = await userService.setDefaultAccount(user, account, {
      setDefaultCurrency: true,
    });

    return {
      action: 'default_set',
      account: buildAccountInfo(
        account,
        AccountService.isDefaultAccount(updatedUser, account),
      ),
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Failed to set default account: ${err instanceof Error ? err.message : String(err)}`,
      code: 'SET_DEFAULT_FAILED',
    };
  }
}

async function handleAccountInfo(
  args: ParsedArgs,
  ctx: SdkContext,
): Promise<AccountCommandResult> {
  const accountId = args.positional[1];
  if (!accountId) {
    return {
      action: 'error',
      error: 'Missing account ID. Usage: agicash account info <id>',
      code: 'MISSING_ACCOUNT_ID',
    };
  }

  let account: Account;
  try {
    account = await ctx.accountRepo.get(accountId);
  } catch {
    return {
      action: 'error',
      error: `Account not found: ${accountId}`,
      code: 'ACCOUNT_NOT_FOUND',
    };
  }

  const user = await ctx.wallet.queryClient.fetchQuery(
    ctx.wallet.queries.userQuery(),
  );
  const isDefault = AccountService.isDefaultAccount(user, account);

  return {
    action: 'info',
    account: buildAccountInfo(account, isDefault),
  };
}
