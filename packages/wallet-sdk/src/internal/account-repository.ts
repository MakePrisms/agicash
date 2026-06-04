/**
 * Internal `wallet.accounts` repository — Slice 2 (accounts + scan).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/accounts/account-repository.ts` (`get` / `getAllActive` /
 * `create`) + `account-service.ts` (`addCashuAccount`). Master expresses these over a
 * React-hook-constructed repository wired to a TanStack `QueryClient`; here they are plain
 * async methods over the SDK-owned Supabase client (passed in), reading/writing the
 * `wallet.accounts` table (joined with `cashu_proofs`) and mapping rows via
 * {@link dbAccountToAccount}.
 *
 * The live wallet handle + proof decryption are resolved through the injected
 * {@link AccountHandleResolver} (deferred to Slice 3; see `account-handle-resolver.ts`). The
 * `expires_at`-from-keyset path master runs for `offer` accounts in `addCashuAccount` needs
 * the mint keysets (a networked read = Slice 3); offers are out of v1 (§13), so `add`
 * persists `expires_at: null` and a Slice-3 follow-up wires the keyset-expiry path when
 * offer creation lands.
 *
 * @module
 */
import { DomainError } from '../errors';
import type { Account, AddAccountConfig } from '../types/account';
import type { AccountHandleResolver } from './account-handle-resolver';
import {
  type AgicashDbAccountWithProofs,
  CashuAccountDetailsDbDataSchema,
  SparkAccountDetailsDbDataSchema,
  dbAccountToAccount,
} from './db-account';
import { checkIsTestMint, normalizeMintUrl } from './lib-cashu';
import type { WalletSupabaseClient } from './supabase-client';

/** The `select` projection master uses: the account row joined with its UNSPENT proofs. */
const ACCOUNT_WITH_PROOFS_SELECT = '*, cashu_proofs(*)';

/**
 * Reads + writes for the `wallet.accounts` table, scoped (via RLS) to the signed-in user.
 *
 * Holds the SDK-owned Supabase client + the {@link AccountHandleResolver}. Methods take the
 * `userId` the account domain resolves from the current session.
 */
export class AccountRepository {
  /**
   * @param db - the SDK-owned Supabase client (schema pinned to `wallet`).
   * @param resolver - fills in each account's deferred live-handle fields (Slice 2 stub /
   *   Slice 3 real).
   */
  constructor(
    private readonly db: WalletSupabaseClient,
    private readonly resolver: AccountHandleResolver,
  ) {}

  /**
   * Get the account with the given id (or null if not found).
   *
   * Verbatim logic from master `AccountRepository.get`: select the account joined with its
   * UNSPENT proofs, then map via {@link dbAccountToAccount}. The proof limit master notes
   * (≤6000) is a server concern and unchanged here.
   *
   * @param id - the account id.
   * @returns the account, or null.
   * @throws Error if the read fails.
   */
  async get(id: string): Promise<Account | null> {
    const { data, error } = await this.db
      .from('accounts')
      .select(ACCOUNT_WITH_PROOFS_SELECT)
      .eq('id', id)
      .eq('cashu_proofs.state', 'UNSPENT')
      .maybeSingle<AgicashDbAccountWithProofs>();

    if (error) {
      throw new Error('Failed to get account', { cause: error });
    }

    return data ? dbAccountToAccount(data, this.resolver) : null;
  }

  /**
   * Get all ACTIVE accounts for the user (with their UNSPENT proofs).
   *
   * Verbatim logic from master `AccountRepository.getAllActive`: filter to `state='active'`
   * and join UNSPENT proofs, then map each row. This is the read backing `accounts.list`.
   *
   * @param userId - the owning user id.
   * @returns the active accounts.
   * @throws Error if the read fails.
   */
  async getAllActive(userId: string): Promise<Account[]> {
    const { data, error } = await this.db
      .from('accounts')
      .select(ACCOUNT_WITH_PROOFS_SELECT)
      .eq('user_id', userId)
      .eq('state', 'active')
      .eq('cashu_proofs.state', 'UNSPENT')
      .returns<AgicashDbAccountWithProofs[]>();

    if (error) {
      throw new Error('Failed to get accounts', { cause: error });
    }

    return Promise.all(
      data.map((row) => dbAccountToAccount(row, this.resolver)),
    );
  }

  /**
   * Map a `wallet.accounts` realtime broadcast row (joined with its proofs) to the domain
   * {@link Account}.
   *
   * Mirrors master `AccountRepository.toAccount` (used by `useAccountChangeHandlers`): it just
   * delegates to {@link dbAccountToAccount} with the repository's live-handle resolver. The
   * Slice-5 realtime account forwarder calls this to translate an `ACCOUNT_CREATED` /
   * `ACCOUNT_UPDATED` payload into the domain account it emits.
   *
   * @param row - the broadcast account row (with its proofs).
   * @returns the domain account.
   */
  async toAccount(row: AgicashDbAccountWithProofs): Promise<Account> {
    return dbAccountToAccount(row, this.resolver);
  }

  /**
   * Create an account from an {@link AddAccountConfig} and return the mapped domain account.
   *
   * Re-houses master `account-service.addCashuAccount` + `account-repository.create`: builds
   * the per-type `details` JSON (cashu: normalised mint URL + test-mint detection + empty
   * keyset counters; spark: network), inserts the row, and maps the result. `name` defaults
   * to the mint URL (cashu) / `'Spark'` (spark) when omitted. `expires_at` is `null`
   * (the offer keyset-expiry path is Slice 3; offers are out of v1).
   *
   * @param userId - the owning user id.
   * @param config - the account create config.
   * @returns the created account.
   * @throws DomainError if the mint's account limit is reached, or (cashu) the mint+currency
   *   account already exists.
   * @throws Error if the insert otherwise fails.
   */
  async add(userId: string, config: AddAccountConfig): Promise<Account> {
    const network = config.type === 'spark' ? 'MAINNET' : undefined;

    const details =
      config.type === 'cashu'
        ? CashuAccountDetailsDbDataSchema.parse({
            mint_url: normalizeMintUrl(config.mintUrl),
            is_test_mint: checkIsTestMint(config.mintUrl),
            keyset_counters: {},
          })
        : SparkAccountDetailsDbDataSchema.parse({ network });

    const name =
      config.name ??
      (config.type === 'cashu' ? normalizeMintUrl(config.mintUrl) : 'Spark');

    const row = {
      name,
      type: config.type,
      currency: config.currency,
      details,
      user_id: userId,
      purpose: 'transactional',
      expires_at: null,
    };

    const { data, error, status } = await this.db
      .from('accounts')
      // biome-ignore lint/suspicious/noExplicitAny: the Supabase client is untyped until the generated Database types are lifted (a later slice); the insert row shape is enforced above.
      .insert(row as any)
      .select(ACCOUNT_WITH_PROOFS_SELECT)
      .eq('cashu_proofs.state', 'UNSPENT')
      .single<AgicashDbAccountWithProofs>();

    if (error) {
      // Master surfaces the mint's per-account LIMIT_REACHED hint as a DomainError.
      if (error.hint === 'LIMIT_REACHED') {
        throw new DomainError(
          `${error.message} ${error.details ?? ''}`.trim(),
          'ACCOUNT_LIMIT_REACHED',
        );
      }
      // A 409 on a cashu insert = the mint+currency account already exists.
      if (status === 409 && config.type === 'cashu') {
        throw new DomainError(
          'Account for this mint and currency already exists',
          'ACCOUNT_ALREADY_EXISTS',
        );
      }
      throw new Error('Failed to create account', { cause: error });
    }

    return dbAccountToAccount(data, this.resolver);
  }
}
