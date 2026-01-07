import type { Proof } from '@cashu/cashu-ts';
import type { Json } from 'supabase/database.types';
import { proofToY } from '~/lib/cashu';
import type { Money } from '~/lib/money';
import { computeSHA256 } from '~/lib/sha256';
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
import { type Encryption, useEncryption } from '../shared/encryption';
import type {
  CashuLightningReceiveTransactionDetails,
  CashuTokenReceiveTransactionDetails,
} from '../transactions/transaction';
import type { CashuReceiveQuote } from './cashu-receive-quote';

type Options = {
  abortSignal?: AbortSignal;
};

type EncryptedQuoteData = {
  /**
   * The mint quote ID.
   */
  quoteId: string;
  /**
   * The bolt11 payment request.
   * For CASHU_TOKEN quotes, this is the internal invoice used for melt/mint.
   * For LIGHTNING quotes, this is the same as the paymentRequest in CashuLightningReceiveTransactionDetails.
   */
  paymentRequest: string;
  /**
   * Amounts for each blinded message created for this receive.
   * Populated after payment is processed (PAID/COMPLETED states).
   */
  outputAmounts?: number[];
};

type EncryptedDataLightning = CashuLightningReceiveTransactionDetails &
  EncryptedQuoteData;
type EncryptedDataToken = CashuTokenReceiveTransactionDetails &
  EncryptedQuoteData & {
    /**
     * Data related to cross-account cashu token receives.
     */
    tokenReceiveData: {
      sourceMintUrl: string;
      tokenProofs: Proof[];
      meltQuoteId: string;
    };
  };

type CreateQuote = {
  /**
   * ID of the receiving user.
   */
  userId: string;
  /**
   * ID of the receiving account.
   */
  accountId: string;
  /**
   * Amount of the quote.
   */
  amount: Money;
  /**
   * ID of the mint's quote. Used after the payment to exchange the quote for proofs.
   */
  quoteId: string;
  /**
   * Lightning payment request.
   */
  paymentRequest: string;
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
  /**
   * Expiry of the quote in ISO 8601 format.
   */
  expiresAt: string;
  /**
   * Description of the quote.
   */
  description?: string;
  /**
   * The full BIP32 derivation path used to derive the public key for locking the cashu mint quote.
   */
  lockingDerivationPath: string;
  /**
   * Type of the receive.
   * - LIGHTNING - The money is received via Lightning.
   * - CASHU_TOKEN - The money is received as a cashu token. The proofs will be melted
   *   from the account they originated from to pay the request for this receive quote.
   */
  receiveType: CashuReceiveQuote['type'];
  /**
   * Optional fee that the mint charges to mint ecash. This amount is added to the payment request amount.
   */
  mintingFee?: Money;
} & (
  | {
      receiveType: 'LIGHTNING';
    }
  | {
      receiveType: 'CASHU_TOKEN';
      /**
       * The amount of the token to receive.
       */
      tokenAmount: Money;
      /**
       * The fee (in the unit of the token) that will be incurred for spending the proofs as inputs to the melt operation.
       */
      cashuReceiveFee: Money;
      /**
       * The fee reserved for the lightning payment to melt the token proofs to this account.
       */
      lightningFeeReserve: Money;
      /**
       * URL of the source mint where the token proofs originate from.
       */
      sourceMintUrl: string;
      /**
       * The proofs from the source cashu token that will be melted.
       */
      tokenProofs: Proof[];
      /**
       * ID of the melt quote on the source mint.
       */
      meltQuoteId: string;
    }
);

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
    } = params;

    let dataToEncrypt: EncryptedDataLightning | EncryptedDataToken;

    if (receiveType === 'CASHU_TOKEN') {
      const { cashuReceiveFee, tokenAmount, lightningFeeReserve } = params;

      const totalFees = mintingFee
        ? cashuReceiveFee.add(lightningFeeReserve).add(mintingFee)
        : cashuReceiveFee.add(lightningFeeReserve);

      dataToEncrypt = {
        amountReceived: amount,
        tokenAmount,
        cashuReceiveFee,
        lightningFeeReserve,
        mintingFee,
        totalFees,
        quoteId,
        paymentRequest,
        tokenReceiveData: {
          sourceMintUrl: params.sourceMintUrl,
          tokenProofs: params.tokenProofs,
          meltQuoteId: params.meltQuoteId,
        },
      } satisfies EncryptedDataToken;
    } else {
      dataToEncrypt = {
        amountReceived: amount,
        paymentRequest,
        description,
        mintingFee,
        quoteId,
      } satisfies EncryptedDataLightning;
    }

    const [encryptedData, quoteIdHash] = await Promise.all([
      this.encryption.encrypt<EncryptedDataLightning | EncryptedDataToken>(
        dataToEncrypt,
      ),
      computeSHA256(quoteId),
    ]);

    const query = this.db.rpc('create_cashu_receive_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amount.currency,
      p_expires_at: expiresAt,
      p_locking_derivation_path: lockingDerivationPath,
      p_receive_type: receiveType,
      p_encrypted_transaction_details: encryptedData,
      p_encrypted_data: encryptedData,
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
    let dataToEncrypt: EncryptedDataLightning | EncryptedDataToken;

    if (quote.type === 'CASHU_TOKEN') {
      dataToEncrypt = {
        amountReceived: quote.amount,
        tokenAmount: quote.tokenAmount,
        cashuReceiveFee: quote.cashuReceiveFee,
        lightningFeeReserve: quote.lightningFeeReserve,
        mintingFee: quote.mintingFee,
        totalFees: quote.totalFees,
        quoteId: quote.quoteId,
        paymentRequest: quote.paymentRequest,
        outputAmounts,
        tokenReceiveData: {
          sourceMintUrl: quote.tokenReceiveData.sourceMintUrl,
          tokenProofs: quote.tokenReceiveData.tokenProofs,
          meltQuoteId: quote.tokenReceiveData.meltQuoteId,
        },
      } satisfies EncryptedDataToken;
    } else {
      dataToEncrypt = {
        amountReceived: quote.amount,
        paymentRequest: quote.paymentRequest,
        description: quote.description,
        mintingFee: quote.mintingFee,
        quoteId: quote.quoteId,
        outputAmounts,
      } satisfies EncryptedDataLightning;
    }

    const encryptedData = await this.encryption.encrypt(dataToEncrypt);

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
        dleq: x.dleq as Json,
        witness: x.witness as Json,
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
    const { decryptedData, typeData } =
      data.type === 'CASHU_TOKEN'
        ? await this.decryptTokenQuoteData(data)
        : await this.decryptLightningQuoteData(data);

    const baseData = {
      id: data.id,
      userId: data.user_id,
      accountId: data.account_id,
      quoteId: decryptedData.quoteId,
      amount: decryptedData.amountReceived,
      description: (decryptedData as EncryptedDataLightning).description,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      paymentRequest: decryptedData.paymentRequest,
      paymentHash: data.payment_hash,
      version: data.version,
      lockingDerivationPath: data.locking_derivation_path,
      transactionId: data.transaction_id,
      mintingFee: decryptedData.mintingFee,
    };

    if (data.state === 'PAID' || data.state === 'COMPLETED') {
      return {
        ...baseData,
        ...typeData,
        state: data.state,
        keysetId: data.keyset_id ?? '',
        keysetCounter: data.keyset_counter ?? 0,
        outputAmounts: decryptedData.outputAmounts ?? [],
      };
    }

    if (data.state === 'UNPAID' || data.state === 'EXPIRED') {
      return {
        ...baseData,
        ...typeData,
        state: data.state,
      };
    }

    if (data.state === 'FAILED') {
      return {
        ...baseData,
        ...typeData,
        state: data.state,
        failureReason: data.failure_reason ?? '',
      };
    }

    throw new Error(`Unexpected quote state ${data.state}`);
  }

  private async decryptLightningQuoteData(data: AgicashDbCashuReceiveQuote) {
    const [decryptedData] = await this.encryption.decryptBatch<
      [EncryptedDataLightning]
    >([data.encrypted_data]);

    return { decryptedData, typeData: { type: 'LIGHTNING' } as const };
  }

  private async decryptTokenQuoteData(data: AgicashDbCashuReceiveQuote) {
    const [decryptedData] = await this.encryption.decryptBatch<
      [EncryptedDataToken]
    >([data.encrypted_data]);

    if (!decryptedData.tokenReceiveData) {
      throw new Error(
        'Invalid cashu receive quote data. Token receive data is required for CASHU_TOKEN type quotes.',
      );
    }

    if (data.cashu_token_melt_initiated == null) {
      throw new Error(
        'Invalid cashu receive quote data. cashu_token_melt_initiated cannot be null for CASHU_TOKEN type quotes.',
      );
    }

    return {
      decryptedData,
      typeData: {
        type: 'CASHU_TOKEN',
        tokenAmount: decryptedData.tokenAmount,
        cashuReceiveFee: decryptedData.cashuReceiveFee,
        lightningFeeReserve: decryptedData.lightningFeeReserve,
        totalFees: decryptedData.totalFees,
        tokenReceiveData: {
          sourceMintUrl: decryptedData.tokenReceiveData.sourceMintUrl,
          tokenProofs: decryptedData.tokenReceiveData.tokenProofs,
          meltQuoteId: decryptedData.tokenReceiveData.meltQuoteId,
          meltInitiated: data.cashu_token_melt_initiated,
        },
      } as const,
    };
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
