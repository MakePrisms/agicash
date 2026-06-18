import type { Currency } from '@agicash/money';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NotFoundError, SdkError } from '../../errors';
import type { RedactedAccount } from '../../types/account';
import { classify } from '../classify';
import type { CashuWalletService } from '../connections/cashu-wallet';
import type { SparkWalletService } from '../connections/spark-wallet';
import {
  CashuAccountDetailsDbDataSchema,
  SparkAccountDetailsDbDataSchema,
  isCashuAccount,
  isSparkAccount,
} from '../db/account-details';
import type { AgicashDbAccountWithProofs, Database } from '../db/database';

type Options = { abortSignal?: AbortSignal };

/**
 * Server-side account resolution for the LN-address flow. Reads the user's
 * default receiving account WITHOUT decrypting cashu proofs (the server has no
 * per-user key): cashu wallets are built seedless (sufficient for createLockedMintQuote),
 * spark wallets come from the dedicated server SparkWalletService.
 */
export class ServerAccountRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly cashuWallets: CashuWalletService,
    private readonly sparkWallets: SparkWalletService,
  ) {}

  /** The user's default account for `currency` (defaults to the user's `default_currency`). */
  async getDefaultAccount(
    userId: string,
    currency?: Currency,
    options?: Options,
  ): Promise<RedactedAccount> {
    const query = this.db
      .from('users')
      .select('*, accounts:accounts!user_id(*, cashu_proofs(*))')
      .eq('id', userId)
      .eq('accounts.cashu_proofs.state', 'UNSPENT');
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data, error } = await query.single();
    if (error) throw classify(error);

    const accountCurrency = currency ?? data.default_currency;
    const defaultAccountId =
      accountCurrency === 'BTC'
        ? data.default_btc_account_id
        : data.default_usd_account_id;
    const account = (data.accounts as AgicashDbAccountWithProofs[]).find(
      (a) => a.id === defaultAccountId,
    );
    if (!account) {
      throw new NotFoundError(
        `No default ${accountCurrency} account for user`,
        'account_not_found',
      );
    }
    return this.toRedactedAccount(account);
  }

  private async toRedactedAccount(
    data: AgicashDbAccountWithProofs,
  ): Promise<RedactedAccount> {
    const common = {
      id: data.id,
      name: data.name,
      currency: data.currency,
      purpose: data.purpose,
      state: data.state,
      createdAt: data.created_at,
      version: data.version,
      expiresAt: data.expires_at,
    };

    if (isCashuAccount(data)) {
      const details = CashuAccountDetailsDbDataSchema.parse(data.details);
      const { wallet, isOnline } = await this.cashuWallets.getInitialized(
        details.mint_url,
        data.currency,
        undefined, // seedless: createLockedMintQuote needs no bip39 seed
        undefined, // no mint-auth provider server-side
      );
      return {
        ...common,
        isOnline,
        type: 'cashu',
        mintUrl: details.mint_url,
        isTestMint: details.is_test_mint,
        keysetCounters: details.keyset_counters,
        wallet,
      } as RedactedAccount;
    }

    if (isSparkAccount(data)) {
      const { network } = SparkAccountDetailsDbDataSchema.parse(data.details);
      const { wallet, balance, isOnline } =
        await this.sparkWallets.getInitialized(network);
      return {
        ...common,
        type: 'spark',
        balance,
        network,
        isOnline,
        wallet,
      } as RedactedAccount;
    }

    throw new SdkError('Invalid account type', 'invalid_account_type');
  }
}
