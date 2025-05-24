import type { Proof, Token } from '@cashu/cashu-ts';
import { Money } from '~/lib/money';
import { sum } from '~/lib/utils';
import {
  type AgicashDb,
  type AgicashDbCashuTokenSwap,
  agicashDb,
} from '../agicash-db/database';
import { getTokenHash, tokenToMoney } from '../shared/cashu';
import { getDefaultUnit } from '../shared/currencies';
import { useEncryption } from '../shared/encryption';
import type { CashuTokenSwap } from './cashu-token-swap';

type Options = {
  abortSignal?: AbortSignal;
};

type Encryption = {
  encrypt: <T = unknown>(data: T) => Promise<string>;
  decrypt: <T = unknown>(data: string) => Promise<T>;
};

type CreateTokenSwap = {
  /**
   * ID of the receiving user.
   */
  userId: string;
  /**
   * ID of the receiving account.
   */
  accountId: string;
  /**
   * Keyset ID.
   */
  keysetId: string;
  /**
   * Keyset counter.
   */
  keysetCounter: number;
  /**
   * Output amounts.
   */
  outputAmounts: number[];
  /**
   * The amount of the fee in the unit of the token.
   */
  fee: number;
  /**
   * Cashu token being claimed
   */
  token: Token;
  /**
   * Version of the account as seen by the client. Used for optimistic concurrency control.
   */
  accountVersion: number;
  /**
   * Type of the token swap
   *
   * - RECEIVE: directly receiving a token
   * - CANCEL_CASHU_SEND_SWAP: cancelling a cashu send swap by swapping the sent proofs back to the account
   */
  type: 'RECEIVE' | 'CANCEL_CASHU_SEND_SWAP';
};

export class CashuTokenSwapRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly encryption: Encryption,
  ) {}

  /**
   * Creates a cashu token swap and updates the account keyset counter.
   * @returns Created cashu token swap.
   * @throws Error if a token swap with the same token hash already exists.
   */
  async create(
    {
      token,
      userId,
      accountId,
      keysetId,
      fee,
      keysetCounter,
      outputAmounts,
      accountVersion,
      type,
    }: CreateTokenSwap,
    options?: Options,
  ): Promise<CashuTokenSwap> {
    const amount = tokenToMoney(token);
    const unit = getDefaultUnit(amount.currency);
    const tokenHash = await getTokenHash(token);
    const encryptedProofs = await this.encryption.encrypt(token.proofs);

    const query = this.db.rpc('create_cashu_token_swap', {
      p_token_hash: tokenHash,
      p_token_proofs: encryptedProofs,
      p_account_id: accountId,
      p_user_id: userId,
      p_currency: amount.currency,
      p_unit: unit,
      p_keyset_id: keysetId,
      p_keyset_counter: keysetCounter,
      p_output_amounts: outputAmounts,
      p_input_amount: sum(outputAmounts),
      p_receive_amount: sum(outputAmounts) - fee,
      p_fee_amount: fee,
      p_account_version: accountVersion,
      p_type: type,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === '23505') {
        throw new Error('This token has already been claimed');
      }
      throw new Error('Failed to create token swap', { cause: error });
    }

    return CashuTokenSwapRepository.toTokenSwap(data, this.encryption.decrypt);
  }

  /**
   * Completes the token claiming process.
   * Updates the account with new proofs and sets the state to COMPLETED.
   */
  async completeTokenSwap(
    {
      tokenHash,
      userId,
      proofs,
      swapVersion,
      accountVersion,
    }: {
      /**
       * Hash of the token that was claimed.
       */
      tokenHash: string;
      /**
       * ID of the user that is completing the token swap.
       */
      userId: string;
      /**
       * All proofs (existing and new) to be stored in the account.
       */
      proofs: Proof[];
      /**
       * Version of the token swap as seen by the client. Used for optimistic concurrency control.
       */
      swapVersion: number;
      /**
       * Version of the account as seen by the client. Used for optimistic concurrency control.
       */
      accountVersion: number;
    },
    options?: Options,
  ): Promise<void> {
    const encryptedProofs = await this.encryption.encrypt(proofs);

    const query = this.db.rpc('complete_cashu_token_swap', {
      p_token_hash: tokenHash,
      p_user_id: userId,
      p_swap_version: swapVersion,
      p_proofs: encryptedProofs,
      p_account_version: accountVersion,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw new Error('Failed to complete token claim', error);
    }
  }

  /**
   * Updates the state of a token swap to FAILED.
   */
  async fail(
    {
      tokenHash,
      userId,
      reason,
      version,
    }: {
      /**
       * Hash of the token to be failed.
       */
      tokenHash: string;
      /**
       * ID of the user that is failing the token swap.
       */
      userId: string;
      /**
       * Reason for the failure.
       */
      reason: string;
      /**
       * Version of the token swap as seen by the client. Used for optimistic concurrency control.
       */
      version: number;
    },
    options?: Options,
  ): Promise<void> {
    const query = this.db.rpc('fail_cashu_token_swap', {
      p_token_hash: tokenHash,
      p_user_id: userId,
      p_swap_version: version,
      p_failure_reason: reason,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { error } = await query;

    if (error) {
      throw new Error('Failed to fail token swap', { cause: error });
    }
  }

  /**
   * Gets all pending token swaps for a given user.
   * @returns All token swaps in a PENDING state for the given user.
   */
  async getPending(
    userId: string,
    options?: Options,
  ): Promise<CashuTokenSwap[]> {
    const query = this.db.from('cashu_token_swaps').select().match({
      user_id: userId,
      state: 'PENDING',
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to get pending token swaps', { cause: error });
    }

    return Promise.all(
      data.map((item) =>
        CashuTokenSwapRepository.toTokenSwap(item, this.encryption.decrypt),
      ),
    );
  }

  static async toTokenSwap(
    data: AgicashDbCashuTokenSwap,
    decryptData: Encryption['decrypt'],
  ): Promise<CashuTokenSwap> {
    const decryptedData = {
      ...data,
      token_proofs: await decryptData<Proof[]>(data.token_proofs),
    };

    return {
      tokenHash: decryptedData.token_hash,
      tokenProofs: decryptedData.token_proofs,
      userId: decryptedData.user_id,
      accountId: decryptedData.account_id,
      amount: new Money({
        amount: decryptedData.input_amount,
        currency: decryptedData.currency,
        unit: decryptedData.unit,
      }),
      keysetId: data.keyset_id,
      keysetCounter: data.keyset_counter,
      outputAmounts: data.output_amounts,
      createdAt: data.created_at,
      state: data.state as CashuTokenSwap['state'],
      version: data.version,
      transactionId: data.transaction_id,
      type: data.type,
    };
  }
}

export function useCashuTokenSwapRepository() {
  const encryption = useEncryption();
  return new CashuTokenSwapRepository(agicashDb, encryption);
}
