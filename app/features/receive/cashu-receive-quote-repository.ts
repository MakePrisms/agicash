import type { Proof } from '@cashu/cashu-ts';
import type { z } from 'zod';
import { proofToY } from '~/lib/cashu';
import { computeSHA256 } from '~/lib/sha256';
import type { AllUnionFieldsRequired } from '~/lib/type-utils';
import type { CashuAccount } from '../accounts/account';
import {
  type AccountRepository,
  useAccountRepository,
} from '../accounts/account-repository';
import type {
  AgicashDb,
  AgicashDbCashuReceiveQuote,
} from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import { CashuLightningReceiveDbDataSchema } from '../agicash-db/json-models';
import { type Encryption, useEncryption } from '../shared/encryption';
import {
  type CashuReceiveQuote,
  CashuReceiveQuoteSchema,
} from './cashu-receive-quote';
import type { RepositoryCreateQuoteParams } from './cashu-receive-quote-core';

type Options = {
  abortSignal?: AbortSignal;
};

type CreateQuote = RepositoryCreateQuoteParams;

export class CashuReceiveQuoteRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly encryption: Encryption,
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
    } satisfies z.input<typeof CashuLightningReceiveDbDataSchema>);

    const [encryptedReceiveData, quoteIdHash] = await Promise.all([
      this.encryption.encrypt(receiveData),
      computeSHA256(quoteId),
    ]);

    const query = this.db.rpc('create_cashu_receive_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amount.currency,
      p_expires_at: expiresAt,
      p_locking_derivation_path: lockingDerivationPath,
      p_receive_type: receiveType,
      p_encrypted_data: encryptedReceiveData,
      p_quote_id_hash: quoteIdHash,
      p_payment_hash: paymentHash,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to create cashu receive quote', { cause: error });
    }

    return this.toQuote(data);
  }

  /**
   * Expires the cashu receive quote by setting the state to EXPIRED.
   * @param id - The id of the cashu receive quote to expire.
   * @param options - The options for the query.
   * @throws An error if expiring the quote fails.
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
      throw new Error('Failed to expire cashu receive quote', { cause: error });
    }
  }

  /**
   * Fails the cashu receive quote by setting the state to FAILED.
   * @throws An error if failing the quote fails.
   */
  async fail(
    {
      id,
      reason,
    }: {
      /**
       * ID of the cashu receive quote.
       */
      id: string;
      /**
       * Reason for the failure.
       */
      reason: string;
    },
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
      throw new Error('Failed to fail cashu receive quote', { cause: error });
    }
  }

  /**
   * Marks the melt as initiated for a CASHU_TOKEN type cashu receive quote.
   * This sets the cashu_token_melt_initiated column to true.
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
      throw new Error('Failed to mark melt initiated for cashu receive quote', {
        cause: error,
      });
    }

    const updatedQuote = await this.toQuote(data);

    return updatedQuote as CashuReceiveQuote & {
      type: 'CASHU_TOKEN';
    };
  }

  /**
   * Processes the payment of the cashu receive quote.
   * Marks the quote as paid and updates the related data. It also updates the account counter for the keyset.
   * @returns The updated quote and account.
   * @throws An error if processing the payment fails.
   */
  async processPayment(
    {
      quote,
      keysetId,
      outputAmounts,
    }: {
      /**
       * The cashu receive quote to process.
       */
      quote: CashuReceiveQuote;
      /**
       * ID of the keyset used to create the blinded messages.
       */
      keysetId: string;
      /**
       * Amounts for each blinded message created for this receive.
       */
      outputAmounts: number[];
    },
    options?: Options,
  ): Promise<{
    /**
     * The updated quote.
     */
    quote: CashuReceiveQuote;
    /**
     * The updated account.
     */
    account: CashuAccount;
  }> {
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
    } satisfies z.input<typeof CashuLightningReceiveDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(receiveData);

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
      throw new Error('Failed to mark cashu receive quote as paid', {
        cause: error,
      });
    }

    const [updatedQuote, account] = await Promise.all([
      this.toQuote(data.quote),
      this.accountRepository.toAccount<CashuAccount>(data.account),
    ]);

    return { quote: updatedQuote, account };
  }

  /**
   * Completes the cashu receive quote with the given id.
   * Completing the quote means that the quote is paid and the tokens have been minted, so the quote state is updated to COMPLETED and the proofs are stored in the database.
   * @returns The updated quote, account and a list of added proof ids.
   * @throws An error if completing the quote fails.
   */
  async completeReceive(
    {
      quoteId,
      proofs,
    }: {
      /**
       * ID of the cashu receive quote.
       */
      quoteId: string;
      /**
       * Proofs minted for the receive.
       */
      proofs: Proof[];
    },
    options?: Options,
  ): Promise<{
    /**
     * The updated quote.
     */
    quote: CashuReceiveQuote;
    /**
     * The updated account with all the proofs including newly added ones.
     */
    account: CashuAccount;
    /**
     * A list of added proof ids.
     * Use if you need to know which proofs from the account proofs list are newly added.
     */
    addedProofs: string[];
  }> {
    const dataToEncrypt = proofs.flatMap((x) => [x.amount, x.secret]);
    const encryptedData = await this.encryption.encryptBatch(dataToEncrypt);
    const encryptedProofs = proofs.map((x, index) => {
      const encryptedDataIndex = index * 2;
      return {
        keysetId: x.id,
        amount: encryptedData[encryptedDataIndex],
        secret: encryptedData[encryptedDataIndex + 1],
        unblindedSignature: x.C,
        publicKeyY: proofToY(x),
        dleq: x.dleq ?? null,
        witness: x.witness ?? null,
      };
    });

    const query = this.db.rpc('complete_cashu_receive_quote', {
      p_quote_id: quoteId,
      p_proofs: encryptedProofs,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to complete cashu receive quote', {
        cause: error,
      });
    }

    const [quote, account] = await Promise.all([
      this.toQuote(data.quote),
      this.accountRepository.toAccount<CashuAccount>(data.account),
    ]);

    return {
      quote,
      account,
      addedProofs: data.added_proofs.map((x) => x.id),
    };
  }

  /**
   * Gets the cashu receive quote with the given id.
   * @param id - The id of the cashu receive quote to get.
   * @returns The cashu receive quote or null if it does not exist.
   */
  async get(id: string, options?: Options): Promise<CashuReceiveQuote | null> {
    const query = this.db.from('cashu_receive_quotes').select().eq('id', id);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get cashu receive quote', { cause: error });
    }

    return data ? this.toQuote(data) : null;
  }

  async getByTransactionId(
    transactionId: string,
    options?: Options,
  ): Promise<CashuReceiveQuote | null> {
    const query = this.db
      .from('cashu_receive_quotes')
      .select()
      .eq('transaction_id', transactionId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get cashu receive quote by transaction id', {
        cause: error,
      });
    }

    return data ? this.toQuote(data) : null;
  }

  /**
   * Gets all pending (unpaid or expired) cashu receive quotes for the given user.
   * @param userId - The id of the user to get the cashu receive quotes for.
   * @returns The cashu receive quotes.
   */
  async getPending(
    userId: string,
    options?: Options,
  ): Promise<CashuReceiveQuote[]> {
    const query = this.db
      .from('cashu_receive_quotes')
      .select()
      .eq('user_id', userId)
      .in('state', ['UNPAID', 'PAID']);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to get cashu receive quotes', { cause: error });
    }

    return Promise.all(data.map((data) => this.toQuote(data)));
  }

  async toQuote(data: AgicashDbCashuReceiveQuote): Promise<CashuReceiveQuote> {
    const decryptedData = await this.encryption.decrypt(data.encrypted_data);
    const receiveData = CashuLightningReceiveDbDataSchema.parse(decryptedData);

    // `satisfies AllUnionFieldsRequired` gives compile time safety and makes sure that all fields are present and of the correct type.
    // schema parse then is doing cashu receive quote invariant check at runtime. For example it makes sure that tokenReceiveData is present when type is CASHU_TOKEN, etc.
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
            // zod parse will do a runtime check that will make sure that cashu_token_melt_initiated is not null when type is CASHU_TOKEN
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
    } satisfies AllUnionFieldsRequired<
      z.output<typeof CashuReceiveQuoteSchema>
    >);
  }
}

export function useCashuReceiveQuoteRepository() {
  const encryption = useEncryption();
  const accountRepository = useAccountRepository();
  return new CashuReceiveQuoteRepository(
    agicashDbClient,
    encryption,
    accountRepository,
  );
}
