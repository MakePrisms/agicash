import type { Proof } from '@cashu/cashu-ts';
import { sumProofs } from '~/lib/cashu';
import {
  type SpendingConditionData,
  SpendingConditionDataSchema,
} from '~/lib/cashu/types';
import { Money } from '~/lib/money';
import {
  type AgicashDb,
  type AgicashDbCashuSendSwap,
  agicashDb,
} from '../agicash-db/database';
import { getDefaultUnit } from '../shared/currencies';
import { useEncryption } from '../shared/encryption';
import type { CashuTokenSendTransactionDetails } from '../transactions/transaction';
import type { CashuSendSwap } from './cashu-send-swap';

type Options = {
  abortSignal?: AbortSignal;
};

type Encryption = {
  encrypt: <T = unknown>(data: T) => Promise<string>;
  decrypt: <T = unknown>(data: string) => Promise<T>;
};

type CreateSendSwap = {
  /**
   * The id of the account to send from
   */
  accountId: string;
  /**
   * The id of the user creating the swap
   */
  userId: string;
  /**
   * The requested amount to send in the account's currency.
   */
  amountRequested: Money;
  /**
   * The full amount to send including the fee in the account's currency.
   */
  amountToSend: Money;
  /**
   * The total amount spent. This is the sum of amountToSend and the fees.
   */
  totalAmount: Money;
  /**
   * The fee for the swap in the account's currency.
   */
  cashuSendFee: Money;
  /**
   * The fee for the swap in the account's currency.
   */
  cashuReceiveFee: Money;
  /**
   * The proofs being spent as inputs.
   */
  inputProofs: Proof[];
  /**
   * The proofs that we can send.
   * If inputProofs sums to amountToSend, these will be the same;
   * otherwise this will be undefined and we will need to swap to get the correct amount.
   */
  proofsToSend?: Proof[];
  /**
   * The hash of the token being sent
   */
  tokenHash?: string;
  /**
   * All the data required to encumber the proofs with the specified spending conditions.
   */
  spendingConditionData?: SpendingConditionData;
  /**
   * All remaining proofs to keep in the account.
   */
  accountProofs: Proof[];
  /**
   * The keyset id that was used to create the output data.
   */
  keysetId?: string;
  /**
   * The starting counter of the keyset that was used to create the output data.
   */
  keysetCounter?: number;
  /**
   * The output data to use for performing the swap.
   */
  outputAmounts?: {
    keep: number[];
    send: number[];
  };
  /**
   * The version seen by the client for optimistic concurrency control.
   */
  accountVersion: number;
};

export class CashuSendSwapRepository {
  constructor(
    private db: AgicashDb,
    private readonly encryption: Encryption,
  ) {}

  async create(
    {
      accountId,
      userId,
      amountRequested,
      amountToSend,
      totalAmount,
      cashuSendFee,
      cashuReceiveFee,
      inputProofs,
      proofsToSend,
      tokenHash,
      spendingConditionData,
      accountProofs,
      keysetId,
      keysetCounter,
      outputAmounts,
      accountVersion,
    }: CreateSendSwap,
    options?: Options,
  ) {
    const unit = getDefaultUnit(amountToSend.currency);

    const details: CashuTokenSendTransactionDetails = {
      amountSpent: totalAmount,
      cashuSendFee: cashuSendFee,
      cashuReceiveFee: cashuReceiveFee,
      totalFees: cashuSendFee.add(cashuReceiveFee),
      amountToReceive: amountToSend.subtract(cashuReceiveFee),
    };

    const [
      encryptedInputProofs,
      encryptedAccountProofs,
      encryptedProofsToSend,
      encryptedTransactionDetails,
      encryptedSpendingConditionData,
    ] = await Promise.all([
      this.encryption.encrypt(inputProofs),
      this.encryption.encrypt(accountProofs),
      proofsToSend ? this.encryption.encrypt(proofsToSend) : undefined,
      this.encryption.encrypt(details),
      spendingConditionData
        ? this.encryption.encrypt(spendingConditionData)
        : undefined,
    ]);

    const updatedKeysetCounter =
      keysetCounter !== undefined
        ? keysetCounter +
          (outputAmounts
            ? outputAmounts.keep.length + outputAmounts.send.length
            : 0)
        : undefined;

    const query = this.db.rpc('create_cashu_send_swap', {
      p_user_id: userId,
      p_account_id: accountId,
      p_amount_requested: amountRequested.toNumber(unit),
      p_amount_to_send: amountToSend.toNumber(unit),
      p_receive_swap_fee: cashuReceiveFee.toNumber(unit),
      p_send_swap_fee: cashuSendFee.toNumber(unit),
      p_total_amount: totalAmount.toNumber(unit),
      p_input_proofs: encryptedInputProofs,
      p_input_amount: sumProofs(inputProofs),
      p_account_proofs: encryptedAccountProofs,
      p_keyset_id: keysetId,
      p_keyset_counter: keysetCounter,
      p_send_output_amounts: outputAmounts?.send ?? undefined,
      p_keep_output_amounts: outputAmounts?.keep ?? undefined,
      p_updated_keyset_counter: updatedKeysetCounter,
      p_currency: amountToSend.currency,
      p_unit: unit,
      p_state: proofsToSend ? 'PENDING' : 'DRAFT',
      p_account_version: accountVersion,
      p_encrypted_transaction_details: encryptedTransactionDetails,
      p_proofs_to_send: encryptedProofsToSend,
      p_token_hash: tokenHash,
      p_spending_condition_data: encryptedSpendingConditionData,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to create cashu send swap', {
        cause: error,
      });
    }

    return CashuSendSwapRepository.toSwap(data, this.encryption.decrypt).catch(
      (e) => {
        console.error('Failed to create cashu send swap', {
          cause: e,
          data,
        });
        throw e;
      },
    );
  }

  async commitProofsToSend({
    swap,
    accountVersion,
    proofsToSend,
    accountProofs,
    tokenHash,
  }: {
    /**
     * The swap to complete.
     */
    swap: CashuSendSwap;
    /**
     * The version of the account to complete.
     */
    accountVersion: number;
    /**
     * The sendable proofs
     */
    proofsToSend: Proof[];
    /**
     * The hash of the token being sent
     */
    tokenHash: string;
    /**
     * The account proofs to keep.
     */
    accountProofs: Proof[];
  }) {
    const [encryptedProofsToSend, encryptedAccountProofs] = await Promise.all([
      this.encryption.encrypt(proofsToSend),
      this.encryption.encrypt(accountProofs),
    ]);

    const query = this.db.rpc('commit_proofs_to_send', {
      p_swap_id: swap.id,
      p_swap_version: swap.version,
      p_account_version: accountVersion,
      p_proofs_to_send: encryptedProofsToSend,
      p_account_proofs: encryptedAccountProofs,
      p_token_hash: tokenHash,
    });

    const { error } = await query;

    if (error) {
      throw new Error('Failed to complete cashu send swap', {
        cause: error,
      });
    }
  }

  async complete({
    swapId,
    swapVersion,
  }: { swapId: string; swapVersion: number }) {
    const query = this.db.rpc('complete_cashu_send_swap', {
      p_swap_id: swapId,
      p_swap_version: swapVersion,
    });

    const { error } = await query;

    if (error) {
      throw new Error('Failed to complete cashu send swap', {
        cause: error,
      });
    }
  }

  async fail({
    swapId,
    swapVersion,
    reason,
  }: { swapId: string; swapVersion: number; reason: string }) {
    const query = this.db.rpc('fail_cashu_send_swap', {
      p_swap_id: swapId,
      p_swap_version: swapVersion,
      p_reason: reason,
    });

    const { error } = await query;

    if (error) {
      throw new Error('Failed to fail cashu send swap', {
        cause: error,
      });
    }
  }

  async getUnresolved(userId: string, options?: Options) {
    const query = this.db
      .from('cashu_send_swaps')
      .select()
      .eq('user_id', userId)
      .in('state', ['DRAFT', 'PENDING']);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to get unresolved cashu send swaps', {
        cause: error,
      });
    }

    return await Promise.all(
      data.map((data) =>
        CashuSendSwapRepository.toSwap(data, this.encryption.decrypt),
      ),
    );
  }

  async get(id: string, options?: Options) {
    const query = this.db.from('cashu_send_swaps').select().eq('id', id);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get cashu send swap', {
        cause: error,
      });
    }

    return data
      ? CashuSendSwapRepository.toSwap(data, this.encryption.decrypt)
      : null;
  }

  async getByTransactionId(transactionId: string, options?: Options) {
    const query = this.db
      .from('cashu_send_swaps')
      .select()
      .eq('transaction_id', transactionId);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get cashu send swap by transaction id', {
        cause: error,
      });
    }

    return data
      ? CashuSendSwapRepository.toSwap(data, this.encryption.decrypt)
      : null;
  }

  static async toSwap(
    data: AgicashDbCashuSendSwap,
    decrypt: Encryption['decrypt'],
  ): Promise<CashuSendSwap> {
    const [inputProofs, proofsToSend, spendingConditionData] =
      await Promise.all([
        decrypt<Proof[]>(data.input_proofs),
        data.proofs_to_send ? decrypt<Proof[]>(data.proofs_to_send) : undefined,
        data.spending_condition_data
          ? decrypt<SpendingConditionData>(data.spending_condition_data)
          : undefined,
      ]);

    let validatedSpendingConditionData: SpendingConditionData | null = null;
    if (spendingConditionData) {
      const validationResult = SpendingConditionDataSchema.safeParse(
        spendingConditionData,
      );
      if (!validationResult.success) {
        throw new Error('Invalid spending condition data', {
          cause: {
            data: spendingConditionData,
            errors: validationResult.error.errors,
          },
        });
      }
      validatedSpendingConditionData = validationResult.data;
    }

    const toMoney = (amount: number) => {
      return new Money({
        amount,
        currency: data.currency,
        unit: data.unit,
      });
    };

    const commonData = {
      id: data.id,
      accountId: data.account_id,
      userId: data.user_id,
      transactionId: data.transaction_id,
      amountRequested: toMoney(data.amount_requested),
      amountToSend: toMoney(data.amount_to_send),
      totalAmount: toMoney(data.total_amount),
      cashuReceiveFee: toMoney(data.receive_swap_fee),
      cashuSendFee: toMoney(data.send_swap_fee),
      inputProofs,
      inputAmount: toMoney(data.input_amount),
      spendingConditionData: validatedSpendingConditionData,
      currency: data.currency,
      version: data.version,
      state: data.state,
      createdAt: new Date(data.created_at),
    };

    if (data.state === 'DRAFT') {
      if (
        !data.keyset_id ||
        data.keyset_counter === null ||
        !data.send_output_amounts ||
        !data.keep_output_amounts
      ) {
        throw new Error('Invalid swap, DRAFT state is missing data', {
          cause: data,
        });
      }
      return {
        ...commonData,
        keysetId: data.keyset_id,
        keysetCounter: data.keyset_counter,
        outputAmounts: {
          keep: data.keep_output_amounts,
          send: data.send_output_amounts,
        },
        state: 'DRAFT',
      };
    }

    if (data.state === 'PENDING' || data.state === 'COMPLETED') {
      if (!data.token_hash || !proofsToSend) {
        throw new Error(
          'Invalid swap, token hash or proofs to send are missing',
          {
            cause: data,
          },
        );
      }
      return {
        ...commonData,
        proofsToSend: proofsToSend,
        tokenHash: data.token_hash,
        state: data.state,
      };
    }

    if (data.state === 'FAILED') {
      if (!data.failure_reason) {
        throw new Error('Invalid swap, failure reason is missing', {
          cause: data,
        });
      }
      return {
        ...commonData,
        state: 'FAILED',
        failureReason: data.failure_reason,
      };
    }

    if (data.state === 'REVERSED') {
      return {
        ...commonData,
        state: 'REVERSED',
      };
    }

    throw new Error(`Unexpected swap state ${data.state}`);
  }
}

export function useCashuSendSwapRepository() {
  const encryption = useEncryption();
  return new CashuSendSwapRepository(agicashDb, encryption);
}
