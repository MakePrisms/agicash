import type { Proof } from '@cashu/cashu-ts';
import { getCashuUnit } from '~/lib/cashu';
import { Money } from '~/lib/money';
import type { CashuAccount } from '../accounts/account';
import {
  type AccountRepository,
  useAccountRepository,
} from '../accounts/account-repository';
import {
  type AgicashDb,
  type AgicashDbCashuReceiveQuote,
  agicashDb,
} from '../agicash-db/database';
import { getDefaultUnit } from '../shared/currencies';
import { useEncryption } from '../shared/encryption';
import type {
  CashuLightningReceiveTransactionDetails,
  CashuTokenReceiveTransactionDetails,
} from '../transactions/transaction';
import type { CashuReceiveQuote } from './cashu-receive-quote';

type Options = {
  abortSignal?: AbortSignal;
};

type Encryption = {
  encrypt: <T = unknown>(data: T) => Promise<string>;
  decrypt: <T = unknown>(data: string) => Promise<T>;
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
   * Expiry of the quote in ISO 8601 format.
   */
  expiresAt: string;
  /**
   * Description of the quote.
   */
  description?: string;
  /**
   * State of the quote.
   */
  state: CashuReceiveQuote['state'];
  /**
   * The full BIP32 derivation path used to derive the public key for locking the cashu mint quote.
   */
  lockingDerivationPath: string;
  /**
   * Type of the receive.
   * LIGHTNING - The money is received via Lightning.
   * TOKEN - The money is received as cashu token. Those proofs are then used to mint tokens for the receiver's account via Lightning.
   *         Used for cross-account cashu token receives where the receiver chooses to claim a token to an account different from the mint/unit the token originated from, thus requiring a lightning payment.
   */
  receiveType: CashuReceiveQuote['type'];
} & (
  | {
      receiveType: 'LIGHTNING';
    }
  | {
      receiveType: 'TOKEN';
      /**
       * The amount of the token to receive.
       */
      tokenAmount: Money;
      /**
       * The fee in the unit of the token that will be incurred for spending the proofs as inputs to the melt operation.
       */
      cashuReceiveFee: number;
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
      expiresAt,
      description,
      state,
      lockingDerivationPath,
      receiveType,
    } = params;

    const unit = getDefaultUnit(amount.currency);

    let details:
      | CashuLightningReceiveTransactionDetails
      | CashuTokenReceiveTransactionDetails;

    if (receiveType === 'TOKEN') {
      const { cashuReceiveFee, tokenAmount } = params;

      const cashuReceiveFeeMoney = new Money({
        amount: cashuReceiveFee,
        currency: amount.currency,
        unit: getCashuUnit(amount.currency),
      });

      details = {
        amountReceived: amount,
        tokenAmount,
        cashuReceiveFee: cashuReceiveFeeMoney,
        totalFees: cashuReceiveFeeMoney,
      } satisfies CashuTokenReceiveTransactionDetails;
    } else {
      details = {
        amountReceived: amount,
        paymentRequest,
        description,
      } satisfies CashuLightningReceiveTransactionDetails;
    }

    const encryptedTransactionDetails = await this.encryption.encrypt(details);

    const query = this.db.rpc('create_cashu_receive_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_amount: amount.toNumber(unit),
      p_currency: amount.currency,
      p_unit: unit,
      p_quote_id: quoteId,
      p_payment_request: paymentRequest,
      p_expires_at: expiresAt,
      p_description: description,
      p_state: state,
      p_locking_derivation_path: lockingDerivationPath,
      p_receive_type: receiveType,
      p_encrypted_transaction_details: encryptedTransactionDetails,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.single();

    if (error) {
      throw new Error('Failed to create cashu receive quote', { cause: error });
    }

    return CashuReceiveQuoteRepository.toQuote(data);
  }

  /**
   * Expires the cashu receive quote by setting the state to EXPIRED.
   */
  async expire(
    {
      id,
      version,
    }: {
      /**
       * ID of the cashu receive quote.
       */
      id: string;
      /**
       * Version of the cashu receive quote as seen by the client. Used for optimistic concurrency control.
       */
      version: number;
    },
    options?: Options,
  ): Promise<void> {
    const query = this.db.rpc('expire_cashu_receive_quote', {
      p_quote_id: id,
      p_quote_version: version,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw new Error('Failed to expire cashu receive quote', { cause: error });
    }
  }

  async fail(
    {
      id,
      version,
      reason,
    }: {
      /**
       * ID of the cashu receive quote.
       */
      id: string;
      /**
       * Version of the cashu receive quote as seen by the client. Used for optimistic concurrency control.
       */
      version: number;
      /**
       * Reason for the failure.
       */
      reason: string;
    },
    options?: Options,
  ): Promise<void> {
    const query = this.db.rpc('fail_cashu_receive_quote', {
      p_quote_id: id,
      p_quote_version: version,
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
   * Processes the payment of the cashu receive quote with the given id.
   * Marks the quote as paid and updates the related data. It also updates the account counter for the keyset.
   */
  async processPayment(
    {
      quoteId,
      quoteVersion,
      keysetId,
      keysetCounter,
      outputAmounts,
      accountVersion,
    }: {
      /**
       * ID of the cashu receive quote.
       */
      quoteId: string;
      /**
       * Version of the cashu receive quote as seen by the client. Used for optimistic concurrency control.
       */
      quoteVersion: number;
      /**
       * ID of the keyset used to create the blinded messages.
       */
      keysetId: string;
      /**
       * Counter value for the keyset at the time the time of quote payment.
       */
      keysetCounter: number;
      /**
       * Amounts for each blinded message
       */
      outputAmounts: number[];
      /**
       * Version of the account as seen by the client. Used for optimistic concurrency control.
       */
      accountVersion: number;
    },
    options?: Options,
  ): Promise<{
    updatedQuote: CashuReceiveQuote;
    updatedAccount: CashuAccount;
  }> {
    const query = this.db.rpc('process_cashu_receive_quote_payment', {
      p_quote_id: quoteId,
      p_quote_version: quoteVersion,
      p_keyset_id: keysetId,
      p_keyset_counter: keysetCounter,
      p_output_amounts: outputAmounts,
      p_account_version: accountVersion,
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

    const updatedQuote = CashuReceiveQuoteRepository.toQuote(
      data.updated_quote,
    );
    const updatedAccount = await this.accountRepository.toAccount(
      data.updated_account,
    );

    return {
      updatedQuote,
      updatedAccount: updatedAccount as CashuAccount,
    };
  }

  /**
   * Completes the cashu receive quote with the given id.
   * Completing the quote means that the quote is paid and the tokens have been minted, so the quote state is updated to COMPLETED and the account is updated with the new proofs.
   */
  async completeReceive(
    {
      quoteId,
      quoteVersion,
      proofs,
      accountVersion,
    }: {
      /**
       * ID of the cashu receive quote.
       */
      quoteId: string;
      /**
       * Version of the cashu receive quote as seen by the client. Used for optimistic concurrency control.
       */
      quoteVersion: number;
      /**
       * Proofs minted for the receive.
       */
      proofs: Proof[];
      /**
       * Version of the account as seen by the client. Used for optimistic concurrency control.
       */
      accountVersion: number;
    },
    options?: Options,
  ): Promise<void> {
    const encryptedProofs = await this.encryption.encrypt(proofs);

    const query = this.db.rpc('complete_cashu_receive_quote', {
      p_quote_id: quoteId,
      p_quote_version: quoteVersion,
      p_proofs: encryptedProofs,
      p_account_version: accountVersion,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw new Error('Failed to complete cashu receive quote', {
        cause: error,
      });
    }
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

    return data ? CashuReceiveQuoteRepository.toQuote(data) : null;
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

    return data ? CashuReceiveQuoteRepository.toQuote(data) : null;
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

    return data.map((data) => CashuReceiveQuoteRepository.toQuote(data));
  }

  static toQuote(data: AgicashDbCashuReceiveQuote): CashuReceiveQuote {
    const commonData = {
      id: data.id,
      userId: data.user_id,
      accountId: data.account_id,
      quoteId: data.quote_id,
      amount: new Money({
        amount: data.amount,
        currency: data.currency,
        unit: data.unit,
      }),
      description: data.description ?? undefined,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      paymentRequest: data.payment_request,
      version: data.version,
      lockingDerivationPath: data.locking_derivation_path,
      transactionId: data.transaction_id,
      type: data.type as CashuReceiveQuote['type'],
    };

    if (data.state === 'PAID' || data.state === 'COMPLETED') {
      return {
        ...commonData,
        state: data.state,
        keysetId: data.keyset_id ?? '',
        keysetCounter: data.keyset_counter ?? 0,
        outputAmounts: data.output_amounts ?? [],
      };
    }

    if (data.state === 'UNPAID' || data.state === 'EXPIRED') {
      return {
        ...commonData,
        state: data.state,
      };
    }

    if (data.state === 'FAILED') {
      return {
        ...commonData,
        state: data.state,
        failureReason: data.failure_reason ?? '',
      };
    }

    throw new Error(`Unexpected quote state ${data.state}`);
  }
}

export function useCashuReceiveQuoteRepository() {
  const encryption = useEncryption();
  const accountRepository = useAccountRepository();
  return new CashuReceiveQuoteRepository(
    agicashDb,
    encryption,
    accountRepository,
  );
}
