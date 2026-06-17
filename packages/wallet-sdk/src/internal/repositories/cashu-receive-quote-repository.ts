import { Money } from '@agicash/money';
import type { Proof } from '@cashu/cashu-ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod/mini';
import { DomainError } from '../../errors';
import type { CashuAccount } from '../../types/account';
import type { CashuReceiveQuote } from '../../types/cashu';
import type { TransactionPurpose } from '../../types/transaction';
import { classify } from '../classify';
import type { EncryptionService } from '../crypto/encryption';
import { sha256Hex } from '../crypto/sha256';
import { toEncryptedProofData } from '../db/cashu-proofs';
import { CashuLightningReceiveDbDataSchema } from '../db/cashu-receive-quote-db-data';
import type { AgicashDbCashuReceiveQuote, Database } from '../db/database';
import { ProofSchema } from '../lib/cashu';
import type { AccountRepository } from './account-repository';

// ---------------------------------------------------------------------------
// CashuReceiveQuoteSchema — ported from app/features/receive/cashu-receive-quote.ts.
// Discriminated on BOTH `type` (LIGHTNING|CASHU_TOKEN) AND `state`.
// ---------------------------------------------------------------------------

const CashuReceiveQuoteBaseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  accountId: z.string(),
  quoteId: z.string(),
  amount: z.instanceof(Money),
  description: z.optional(z.string()),
  createdAt: z.string(),
  expiresAt: z.string(),
  paymentRequest: z.string(),
  paymentHash: z.string(),
  lockingDerivationPath: z.string(),
  transactionId: z.string(),
  mintingFee: z.optional(z.instanceof(Money)),
  totalFee: z.instanceof(Money),
  version: z.number(),
});

const CashuTokenMeltDataSchema = z.object({
  sourceMintUrl: z.string(),
  tokenAmount: z.instanceof(Money),
  tokenProofs: z.array(ProofSchema),
  meltQuoteId: z.string(),
  meltInitiated: z.boolean(),
  cashuReceiveFee: z.instanceof(Money),
  lightningFeeReserve: z.instanceof(Money),
  lightningFee: z.optional(z.instanceof(Money)),
});

const CashuReceiveQuoteLightningTypeSchema = z.object({
  type: z.literal('LIGHTNING'),
});

const CashuReceiveQuoteCashuTokenTypeSchema = z.object({
  type: z.literal('CASHU_TOKEN'),
  tokenReceiveData: CashuTokenMeltDataSchema,
});

const CashuReceiveQuoteUnpaidExpiredStateSchema = z.object({
  state: z.enum(['UNPAID', 'EXPIRED']),
});

const CashuReceiveQuotePaidCompletedStateSchema = z.object({
  state: z.enum(['PAID', 'COMPLETED']),
  keysetId: z.string(),
  keysetCounter: z.number(),
  outputAmounts: z.array(z.number()),
});

const CashuReceiveQuoteFailedStateSchema = z.object({
  state: z.literal('FAILED'),
  failureReason: z.string(),
});

export const CashuReceiveQuoteSchema = z.intersection(
  CashuReceiveQuoteBaseSchema,
  z.intersection(
    z.union([
      CashuReceiveQuoteLightningTypeSchema,
      CashuReceiveQuoteCashuTokenTypeSchema,
    ]),
    z.union([
      CashuReceiveQuoteUnpaidExpiredStateSchema,
      CashuReceiveQuotePaidCompletedStateSchema,
      CashuReceiveQuoteFailedStateSchema,
    ]),
  ),
);

// Compile-time check: schema output must be assignable to the contract type.
type _SchemaFitsContract = z.infer<
  typeof CashuReceiveQuoteSchema
> extends CashuReceiveQuote
  ? true
  : never;
const _check: _SchemaFitsContract = true;
void _check;

// ---------------------------------------------------------------------------
// Public input type + repository
// ---------------------------------------------------------------------------

/** Parameters for creating a receive quote (ported from RepositoryCreateQuoteParams). */
export type CreateQuote = {
  /** ID of the receiving user. */
  userId: string;
  /** ID of the receiving account. */
  accountId: string;
  /** Amount of the quote. */
  amount: Money;
  /** ID of the mint's quote. */
  quoteId: string;
  /** Lightning payment request. */
  paymentRequest: string;
  /** Payment hash of the lightning invoice. */
  paymentHash: string;
  /** Expiry of the quote in ISO 8601 format. */
  expiresAt: string;
  /** Description of the quote. */
  description?: string;
  /** The full BIP32 derivation path used to derive the public key for locking the cashu mint quote. */
  lockingDerivationPath: string;
  /** Type of the receive. */
  receiveType: CashuReceiveQuote['type'];
  /** Optional fee that the mint charges to mint ecash. */
  mintingFee?: Money;
  /** Total fee for the receive. */
  totalFee: Money;
  /** The purpose of this transaction. */
  purpose?: TransactionPurpose;
  /** UUID linking paired send/receive transactions in a transfer. */
  transferId?: string;
} & (
  | { receiveType: 'LIGHTNING' }
  | {
      receiveType: 'CASHU_TOKEN';
      meltData: {
        tokenMintUrl: string;
        meltQuoteId: string;
        tokenAmount: Money;
        tokenProofs: Proof[];
        cashuReceiveFee: Money;
        lightningFeeReserve: Money;
      };
    }
);

type Options = { abortSignal?: AbortSignal };

/** Data access for `wallet.cashu_receive_quotes`. */
export class CashuReceiveQuoteRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly encryption: EncryptionService,
    private readonly accountRepository: AccountRepository,
  ) {}

  /**
   * Creates a cashu receive quote.
   * @returns Created cashu receive quote.
   */
  async create(
    params: CreateQuote,
    options?: Options,
  ): Promise<CashuReceiveQuote> {
    const {
      userId,
      accountId,
      amount,
      quoteId,
      paymentRequest,
      paymentHash,
      expiresAt,
      description,
      lockingDerivationPath,
      receiveType,
      mintingFee,
      totalFee,
    } = params;

    const receiveData = CashuLightningReceiveDbDataSchema.parse({
      paymentRequest,
      mintQuoteId: quoteId,
      amountReceived: amount,
      description,
      mintingFee,
      cashuTokenMeltData:
        receiveType === 'CASHU_TOKEN' ? params.meltData : undefined,
      totalFee,
    });

    const encryption = await this.encryption.get();
    const [encryptedData, quoteIdHash] = await Promise.all([
      encryption.encrypt(receiveData),
      sha256Hex(quoteId),
    ]);

    const query = this.db.rpc('create_cashu_receive_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amount.currency,
      p_expires_at: expiresAt,
      p_locking_derivation_path: lockingDerivationPath,
      p_receive_type: receiveType,
      p_encrypted_data: encryptedData,
      p_quote_id_hash: quoteIdHash,
      p_payment_hash: paymentHash,
      p_purpose: params.purpose,
      p_transfer_id: params.transferId,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw classify(error);
    }

    return this.toQuote(data);
  }

  /**
   * Expires the cashu receive quote (state → EXPIRED).
   * @param id - The id of the cashu receive quote to expire.
   */
  async expire(id: string, options?: Options): Promise<void> {
    const query = this.db.rpc('expire_cashu_receive_quote', {
      p_quote_id: id,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw classify(error);
    }
  }

  /**
   * Fails the cashu receive quote (state → FAILED).
   * @throws if the RPC fails.
   */
  async fail(
    { id, reason }: { id: string; reason: string },
    options?: Options,
  ): Promise<void> {
    const query = this.db.rpc('fail_cashu_receive_quote', {
      p_quote_id: id,
      p_failure_reason: reason,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw classify(error);
    }
  }

  /**
   * Marks the melt as initiated for a CASHU_TOKEN type cashu receive quote.
   */
  async markMeltInitiated(
    quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' },
    options?: Options,
  ): Promise<CashuReceiveQuote & { type: 'CASHU_TOKEN' }> {
    const query = this.db.rpc(
      'mark_cashu_receive_quote_cashu_token_melt_initiated',
      {
        p_quote_id: quote.id,
      },
    );

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw classify(error);
    }

    const updatedQuote = await this.toQuote(data);

    return updatedQuote as CashuReceiveQuote & { type: 'CASHU_TOKEN' };
  }

  /**
   * Processes the payment of the cashu receive quote (state → PAID).
   * Updates the account keyset counter.
   * @returns The updated quote and account.
   */
  async processPayment(
    {
      quote,
      keysetId,
      outputAmounts,
    }: {
      quote: CashuReceiveQuote;
      keysetId: string;
      outputAmounts: number[];
    },
    options?: Options,
  ): Promise<{ quote: CashuReceiveQuote; account: CashuAccount }> {
    const cashuTokenMeltData =
      quote.type === 'CASHU_TOKEN'
        ? {
            tokenAmount: quote.tokenReceiveData.tokenAmount,
            tokenProofs: quote.tokenReceiveData.tokenProofs,
            tokenMintUrl: quote.tokenReceiveData.sourceMintUrl,
            meltQuoteId: quote.tokenReceiveData.meltQuoteId,
            cashuReceiveFee: quote.tokenReceiveData.cashuReceiveFee,
            lightningFeeReserve: quote.tokenReceiveData.lightningFeeReserve,
          }
        : undefined;

    const receiveData = CashuLightningReceiveDbDataSchema.parse({
      paymentRequest: quote.paymentRequest,
      mintQuoteId: quote.quoteId,
      amountReceived: quote.amount,
      description: quote.description,
      mintingFee: quote.mintingFee,
      cashuTokenMeltData,
      totalFee: quote.totalFee,
      outputAmounts,
    });

    const encryption = await this.encryption.get();
    const encryptedData = await encryption.encrypt(receiveData);

    const query = this.db.rpc('process_cashu_receive_quote_payment', {
      p_quote_id: quote.id,
      p_keyset_id: keysetId,
      p_number_of_outputs: outputAmounts.length,
      p_encrypted_data: encryptedData,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw classify(error);
    }

    const [updatedQuote, account] = await Promise.all([
      this.toQuote(data.quote),
      this.accountRepository.toAccount(data.account) as Promise<CashuAccount>,
    ]);

    return { quote: updatedQuote, account };
  }

  /**
   * Completes the cashu receive quote (state → COMPLETED) and stores the minted proofs.
   * @returns The updated quote, account, and a list of added proof ids.
   */
  async completeReceive(
    {
      quoteId,
      proofs,
    }: {
      quoteId: string;
      proofs: Proof[];
    },
    options?: Options,
  ): Promise<{
    quote: CashuReceiveQuote;
    account: CashuAccount;
    addedProofs: string[];
  }> {
    const encryption = await this.encryption.get();
    const encryptedProofs = await toEncryptedProofData(proofs, encryption);

    const query = this.db.rpc('complete_cashu_receive_quote', {
      p_quote_id: quoteId,
      p_proofs: encryptedProofs,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw classify(error);
    }

    const [quote, account] = await Promise.all([
      this.toQuote(data.quote),
      this.accountRepository.toAccount(data.account) as Promise<CashuAccount>,
    ]);

    return {
      quote,
      account,
      addedProofs: data.added_proofs.map((x) => x.id),
    };
  }

  /**
   * Gets the cashu receive quote with the given id.
   * @returns The cashu receive quote, or null if not found.
   */
  async get(id: string, options?: Options): Promise<CashuReceiveQuote | null> {
    const q = this.db
      .from('cashu_receive_quotes')
      .select()
      .eq('id', id);

    if (options?.abortSignal) {
      q.abortSignal(options.abortSignal);
    }

    const { data, error } = await q.maybeSingle();

    if (error) {
      throw classify(error);
    }

    return data ? this.toQuote(data) : null;
  }

  /**
   * Gets the cashu receive quote with the given transaction id.
   * @returns The cashu receive quote, or null if not found.
   */
  async getByTransactionId(
    transactionId: string,
    options?: Options,
  ): Promise<CashuReceiveQuote | null> {
    const q = this.db
      .from('cashu_receive_quotes')
      .select()
      .eq('transaction_id', transactionId);

    if (options?.abortSignal) {
      q.abortSignal(options.abortSignal);
    }

    const { data, error } = await q.maybeSingle();

    if (error) {
      throw classify(error);
    }

    return data ? this.toQuote(data) : null;
  }

  /**
   * Gets all pending (UNPAID or PAID) cashu receive quotes for the given user.
   * @returns Pending cashu receive quotes.
   */
  async getPending(
    userId: string,
    options?: Options,
  ): Promise<CashuReceiveQuote[]> {
    const q = this.db
      .from('cashu_receive_quotes')
      .select()
      .eq('user_id', userId)
      .in('state', ['UNPAID', 'PAID']);

    if (options?.abortSignal) {
      q.abortSignal(options.abortSignal);
    }

    const { data, error } = await q;

    if (error) {
      throw classify(error);
    }

    return Promise.all((data ?? []).map((x) => this.toQuote(x)));
  }

  private async toQuote(
    data: AgicashDbCashuReceiveQuote | null,
  ): Promise<CashuReceiveQuote> {
    if (!data) {
      throw new DomainError(
        'Expected receive quote data but got null',
        'not_found',
      );
    }

    const encryption = await this.encryption.get();
    const decryptedData = await encryption.decrypt(data.encrypted_data);
    const receiveData = CashuLightningReceiveDbDataSchema.parse(decryptedData);

    return CashuReceiveQuoteSchema.parse({
      id: data.id,
      userId: data.user_id,
      accountId: data.account_id,
      quoteId: receiveData.mintQuoteId,
      amount: receiveData.amountReceived,
      description: receiveData.description,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      paymentRequest: receiveData.paymentRequest,
      paymentHash: data.payment_hash,
      version: data.version,
      lockingDerivationPath: data.locking_derivation_path,
      transactionId: data.transaction_id,
      mintingFee: receiveData.mintingFee,
      totalFee: receiveData.totalFee,
      type: data.type,
      state: data.state,
      tokenReceiveData: receiveData.cashuTokenMeltData
        ? {
            sourceMintUrl: receiveData.cashuTokenMeltData.tokenMintUrl,
            tokenAmount: receiveData.cashuTokenMeltData.tokenAmount,
            tokenProofs: receiveData.cashuTokenMeltData.tokenProofs,
            meltQuoteId: receiveData.cashuTokenMeltData.meltQuoteId,
            // cashu_token_melt_initiated is not null when type is CASHU_TOKEN
            meltInitiated: data.cashu_token_melt_initiated as boolean,
            cashuReceiveFee: receiveData.cashuTokenMeltData.cashuReceiveFee,
            lightningFeeReserve:
              receiveData.cashuTokenMeltData.lightningFeeReserve,
          }
        : undefined,
      keysetId: data.keyset_id,
      keysetCounter: data.keyset_counter,
      outputAmounts: receiveData.outputAmounts,
      failureReason: data.failure_reason ?? undefined,
    });
  }
}
