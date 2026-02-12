import type { Proof } from '@cashu/cashu-ts';
import type { z } from 'zod';
import { proofToY } from '~/lib/cashu';
import type { Money } from '~/lib/money';
import type { AllUnionFieldsRequired } from '~/lib/type-utils';
import type { CashuProof } from '../accounts/cashu-account';
import type {
  AgicashDb,
  AgicashDbCashuProof,
  AgicashDbCashuSendSwap,
} from '../agicash-db/database';
import { agicashDbClient } from '../agicash-db/database.client';
import { CashuSwapSendDbDataSchema } from '../agicash-db/json-models';
import { type Encryption, useEncryption } from '../shared/encryption';
import { ConcurrencyError } from '../shared/error';
import { type CashuSendSwap, CashuSendSwapSchema } from './cashu-send-swap';
import { toDecryptedCashuProofs } from './utils';

type Options = {
  abortSignal?: AbortSignal;
};

type CreateSendSwap = {
  /**
   * The id of the account to send from.
   */
  accountId: string;
  /**
   * The id of the user creating the swap.
   */
  userId: string;
  /**
   * The URL of the mint creating the token.
   */
  tokenMintUrl: string;
  /**
   * The requested amount to send in the account's currency.
   * This is the amount that the sender wants the receiver to receive.
   */
  amountRequested: Money;
  /**
   * The full amount to send including the receive fee in the account's currency.
   * This is `amountRequested` plus `cashuReceiveFee`.
   */
  amountToSend: Money;
  /**
   * The total amount spent for this send.
   * This is the sum of `amountToSend` and `cashuSendFee`.
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
   * The sum of these might be greater than amountToSend, in which case we will need to swap to get the correct amount.
   */
  inputProofs: CashuProof[];
  /**
   * The sum of the input proofs in the account's currency.
   */
  inputAmount: Money;
  /**
   * The hash of the token being sent.
   * Should be set only when send swap is not needed (sum of input proofs is equal to amount to send).
   */
  tokenHash?: string;
  /**
   * The keyset id that was used to create the output data.
   * Should be set only when send swap is needed (sum of input proofs is greater than amount to send).
   */
  keysetId?: string;
  /**
   * The output data to use for performing the swap.
   * Should be set only when send swap is needed (sum of input proofs is greater than amount to send).
   */
  outputAmounts?: {
    send: number[];
    change: number[];
  };
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
      tokenMintUrl,
      amountRequested,
      amountToSend,
      totalAmount,
      cashuSendFee,
      cashuReceiveFee,
      inputProofs,
      inputAmount,
      tokenHash,
      keysetId,
      outputAmounts,
    }: CreateSendSwap,
    options?: Options,
  ) {
    const requiresInputProofsSwap = !inputAmount.equals(amountToSend);

    const dataToEncrypt = CashuSwapSendDbDataSchema.parse({
      tokenMintUrl,
      amountReceived: amountRequested,
      amountToSend,
      cashuReceiveFee,
      cashuSendFee,
      amountSpent: totalAmount,
      amountReserved: inputAmount,
      totalFee: cashuSendFee.add(cashuReceiveFee),
      outputAmounts: outputAmounts
        ? {
            send: outputAmounts.send,
            change: outputAmounts.change,
          }
        : undefined,
    } satisfies z.input<typeof CashuSwapSendDbDataSchema>);

    const encryptedData = await this.encryption.encrypt(dataToEncrypt);

    const numberOfOutputs = requiresInputProofsSwap
      ? (outputAmounts?.send?.length ?? 0) +
        (outputAmounts?.change?.length ?? 0)
      : undefined;

    const query = this.db.rpc('create_cashu_send_swap', {
      p_user_id: userId,
      p_account_id: accountId,
      p_input_proofs: inputProofs.map((p) => p.id),
      p_currency: amountToSend.currency,
      p_encrypted_data: encryptedData,
      p_requires_input_proofs_swap: requiresInputProofsSwap,
      p_token_hash: tokenHash,
      p_keyset_id: keysetId,
      p_number_of_outputs: numberOfOutputs,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      if (error.hint === 'CONCURRENCY_ERROR') {
        throw new ConcurrencyError(error.message, error.details);
      }

      throw new Error('Failed to create cashu send swap', {
        cause: error,
      });
    }

    const swapWithInputProofs = {
      ...data.swap,
      cashu_proofs: data.reserved_proofs,
    };

    return await this.toSwap(swapWithInputProofs);
  }

  async commitProofsToSend({
    swap,
    tokenHash,
    proofsToSend,
    changeProofs,
  }: {
    /**
     * The swap to complete.
     */
    swap: CashuSendSwap;
    /**
     * The hash of the token being sent
     */
    tokenHash: string;
    /**
     * The sendable proofs
     */
    proofsToSend: Proof[];
    /**
     * The change proofs to add back to the account.
     */
    changeProofs: Proof[];
  }) {
    const allProofs = proofsToSend.concat(changeProofs);
    const proofDataToEncrypt = allProofs.flatMap((x) => [x.amount, x.secret]);

    const encryptedProofData =
      await this.encryption.encryptBatch(proofDataToEncrypt);

    const encryptedProofs = allProofs.map((x, index) => {
      const encryptedDataIndex = index * 2;
      return {
        keysetId: x.id,
        amount: encryptedProofData[encryptedDataIndex],
        secret: encryptedProofData[encryptedDataIndex + 1],
        unblindedSignature: x.C,
        publicKeyY: proofToY(x),
        dleq: x.dleq ?? null,
        witness: x.witness ?? null,
      };
    });
    const encryptedProofsToSend = encryptedProofs.slice(0, proofsToSend.length);
    const encryptedChangeProofs = encryptedProofs.slice(proofsToSend.length);

    const query = this.db.rpc('commit_proofs_to_send', {
      p_swap_id: swap.id,
      p_proofs_to_send: encryptedProofsToSend,
      p_change_proofs: encryptedChangeProofs,
      p_token_hash: tokenHash,
    });

    const { error } = await query;

    if (error) {
      throw new Error('Failed to complete cashu send swap', {
        cause: error,
      });
    }
  }

  async complete(swapId: string) {
    const query = this.db.rpc('complete_cashu_send_swap', {
      p_swap_id: swapId,
    });

    const { error } = await query;

    if (error) {
      throw new Error('Failed to complete cashu send swap', {
        cause: error,
      });
    }
  }

  async fail({ swapId, reason }: { swapId: string; reason: string }) {
    const query = this.db.rpc('fail_cashu_send_swap', {
      p_swap_id: swapId,
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
      .select('*, cashu_proofs!spending_cashu_send_swap_id(*)')
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

    return await Promise.all(data.map((data) => this.toSwap(data)));
  }

  async get(id: string, options?: Options) {
    const query = this.db
      .from('cashu_send_swaps')
      .select('*, cashu_proofs!spending_cashu_send_swap_id(*)')
      .eq('id', id);

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error('Failed to get cashu send swap', {
        cause: error,
      });
    }

    return data ? this.toSwap(data) : null;
  }

  async getByTransactionId(transactionId: string, options?: Options) {
    const query = this.db
      .from('cashu_send_swaps')
      .select('*, cashu_proofs!spending_cashu_send_swap_id(*)')
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

    return data ? await this.toSwap(data) : null;
  }

  async toSwap(
    data: AgicashDbCashuSendSwap & { cashu_proofs: AgicashDbCashuProof[] },
  ): Promise<CashuSendSwap> {
    const encryptedInputProofs = data.cashu_proofs.filter(
      (p) => p.cashu_send_swap_id !== data.id,
    );
    const encryptedProofsToSend = data.cashu_proofs.filter(
      (p) =>
        p.cashu_send_swap_id === data.id || !data.requires_input_proofs_swap,
    );
    const encryptedProofs = encryptedInputProofs.concat(encryptedProofsToSend);
    const proofsDataToDecrypt = encryptedProofs.flatMap((x) => [
      x.amount,
      x.secret,
    ]);

    const [decryptedData, ...decryptedProofsData] =
      await this.encryption.decryptBatch([
        data.encrypted_data,
        ...proofsDataToDecrypt,
      ]);

    const decryptedProofs = toDecryptedCashuProofs(
      encryptedProofs,
      decryptedProofsData,
    );
    const inputProofs = decryptedProofs.slice(0, encryptedInputProofs.length);
    const proofsToSend = decryptedProofs.slice(encryptedInputProofs.length);

    const sendData = CashuSwapSendDbDataSchema.parse(decryptedData);

    // `satisfies AllUnionFieldsRequired` gives compile time safety and makes sure that all fields are present and of the correct type.
    // schema parse then is doing cashu send swap invariant check at runtime. For example it makes sure that sendOutputAmounts and changeOutputAmounts are defined when needed.
    return CashuSendSwapSchema.parse({
      id: data.id,
      accountId: data.account_id,
      userId: data.user_id,
      transactionId: data.transaction_id,
      amountReceived: sendData.amountReceived,
      amountToSend: sendData.amountToSend,
      amountSpent: sendData.amountSpent,
      cashuReceiveFee: sendData.cashuReceiveFee,
      cashuSendFee: sendData.cashuSendFee,
      inputProofs: inputProofs,
      inputAmount: sendData.amountReserved,
      totalFee: sendData.totalFee,
      version: data.version,
      state: data.state,
      createdAt: new Date(data.created_at),
      outputAmounts: sendData.outputAmounts
        ? sendData.outputAmounts
        : undefined,
      keysetId: data.keyset_id ?? undefined,
      keysetCounter: data.keyset_counter ?? undefined,
      tokenHash: data.token_hash,
      proofsToSend: proofsToSend,
      failureReason: data.failure_reason ?? undefined,
    } satisfies AllUnionFieldsRequired<z.output<typeof CashuSendSwapSchema>>);
  }
}

export function useCashuSendSwapRepository() {
  const encryption = useEncryption();
  return new CashuSendSwapRepository(agicashDbClient, encryption);
}
