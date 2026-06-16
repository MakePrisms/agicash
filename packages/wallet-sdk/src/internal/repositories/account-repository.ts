import type { Currency } from '@agicash/money';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod/mini';
import { DomainError } from '../../errors';
import type {
  Account,
  AccountPurpose,
  CashuProof,
} from '../../types/account';
import { classify } from '../classify';
import type { Encryption, EncryptionService } from '../crypto/encryption';
import {
  CashuAccountDetailsDbDataSchema,
  SparkAccountDetailsDbDataSchema,
  isCashuAccount,
  isSparkAccount,
} from '../db/account-details';
import type { AgicashDbAccountWithProofs, Database } from '../db/database';
import { ProofSchema, normalizeMintUrl } from '../lib/cashu';
import type { CashuWalletService } from '../connections/cashu-wallet';
import type { MintAuthTokenProvider } from '../connections/mint-auth';
import { getMintAuthProvider } from '../connections/mint-auth';
import type { SparkWalletService } from '../connections/spark-wallet';

type Options = { abortSignal?: AbortSignal };

/** Data access for `wallet.accounts` (+ `cashu_proofs`). Builds live `Account`s. */
export class AccountRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly encryption: EncryptionService,
    private readonly cashuWallets: CashuWalletService,
    private readonly sparkWallets: SparkWalletService,
    private readonly mintAuth: MintAuthTokenProvider,
    private readonly getCashuSeed: () => Promise<Uint8Array>,
  ) {}

  /** The account with this id (with unspent proofs), or null. */
  async get(id: string, options?: Options): Promise<Account | null> {
    const query = this.db
      .from('accounts')
      .select('*, cashu_proofs(*)')
      .eq('id', id)
      .eq('cashu_proofs.state', 'UNSPENT');
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data, error } = await query.maybeSingle();
    if (error) throw classify(error);
    return data ? this.toAccount(data) : null;
  }

  /** All active accounts for the user (with unspent proofs). */
  async getAllActive(userId: string, options?: Options): Promise<Account[]> {
    const query = this.db
      .from('accounts')
      .select('*, cashu_proofs(*)')
      .eq('user_id', userId)
      .eq('state', 'active')
      .eq('cashu_proofs.state', 'UNSPENT');
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data, error } = await query;
    if (error) throw classify(error);
    return Promise.all((data ?? []).map((x) => this.toAccount(x)));
  }

  /** Insert a new account row and return the built `Account`. */
  async create(
    input: {
      userId: string;
      name: string;
      currency: Currency;
      purpose: AccountPurpose;
      expiresAt: string | null;
    } & (
      | { type: 'cashu'; mintUrl: string; isTestMint: boolean }
      | { type: 'spark'; network: 'MAINNET' | 'REGTEST' }
    ),
    options?: Options,
  ): Promise<Account> {
    const details =
      input.type === 'cashu'
        ? CashuAccountDetailsDbDataSchema.parse({
            mint_url: normalizeMintUrl(input.mintUrl),
            is_test_mint: input.isTestMint,
            keyset_counters: {},
          })
        : SparkAccountDetailsDbDataSchema.parse({ network: input.network });

    const query = this.db
      .from('accounts')
      .insert({
        name: input.name,
        type: input.type,
        currency: input.currency,
        details,
        user_id: input.userId,
        purpose: input.purpose,
        expires_at: input.expiresAt,
      })
      .select('*, cashu_proofs(*)')
      .eq('cashu_proofs.state', 'UNSPENT');
    if (options?.abortSignal) query.abortSignal(options.abortSignal);

    const { data, error, status } = await query.single();
    if (error) {
      if (error.hint === 'LIMIT_REACHED') {
        throw new DomainError(`${error.message} ${error.details}`, 'LIMIT_REACHED');
      }
      if (status === 409 && input.type === 'cashu') {
        throw new DomainError(
          'Account for this mint and currency already exists',
          'DUPLICATE_ACCOUNT',
        );
      }
      throw classify(error);
    }
    return this.toAccount(data);
  }

  /** Map a DB row (+ proofs) to a live `Account` (cashu wallet-init / spark connect). */
  async toAccount(data: AgicashDbAccountWithProofs): Promise<Account> {
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
      const [{ wallet, isOnline }, proofs] = await Promise.all([
        this.initCashuWallet(details.mint_url, data.currency, data.purpose),
        this.decryptCashuProofs(data),
      ]);
      return {
        ...common,
        isOnline,
        type: 'cashu',
        mintUrl: details.mint_url,
        isTestMint: details.is_test_mint,
        keysetCounters: details.keyset_counters,
        proofs,
        wallet,
      } as Account;
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
      } as Account;
    }

    throw new Error('Invalid account type');
  }

  private async initCashuWallet(
    mintUrl: string,
    currency: Currency,
    purpose: AccountPurpose,
  ) {
    const seed = await this.getCashuSeed();
    const authProvider = getMintAuthProvider(purpose, this.mintAuth);
    return this.cashuWallets.getInitialized(
      mintUrl,
      currency,
      seed,
      authProvider,
    );
  }

  private async decryptCashuProofs(
    data: AgicashDbAccountWithProofs,
  ): Promise<CashuProof[]> {
    if (!isCashuAccount(data)) {
      throw new Error('Account is not a cashu account');
    }
    const encryption: Encryption = await this.encryption.get();
    const encrypted = data.cashu_proofs.flatMap((x) => [x.amount, x.secret]);
    const decrypted = await encryption.decryptBatch(encrypted);
    return data.cashu_proofs.map((dbProof, index) => {
      const i = index * 2;
      return {
        id: dbProof.id,
        accountId: dbProof.account_id,
        userId: dbProof.user_id,
        keysetId: dbProof.keyset_id,
        amount: z.number().parse(decrypted[i]),
        secret: z.string().parse(decrypted[i + 1]),
        unblindedSignature: dbProof.unblinded_signature,
        publicKeyY: dbProof.public_key_y,
        dleq: ProofSchema.shape.dleq.parse(dbProof.dleq),
        witness: ProofSchema.shape.witness.parse(dbProof.witness),
        state: dbProof.state,
        version: dbProof.version,
        createdAt: dbProof.created_at,
        reservedAt: dbProof.reserved_at,
      };
    });
  }
}
