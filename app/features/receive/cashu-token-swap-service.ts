import {
  type CashuWallet,
  MintOperationError,
  OutputData,
  type Token,
} from '@cashu/cashu-ts';
import {
  CashuErrorCodes,
  areMintUrlsEqual,
  getCashuUnit,
  getOutputAmounts,
  sumProofs,
} from '~/lib/cashu';
import { Money } from '~/lib/money';
import type { CashuAccount } from '../accounts/account';
import { tokenToMoney } from '../shared/cashu';
import type { CashuTokenSwap } from './cashu-token-swap';
import {
  type CashuTokenSwapRepository,
  useCashuTokenSwapRepository,
} from './cashu-token-swap-repository';

export class CashuTokenSwapService {
  constructor(private readonly tokenSwapRepository: CashuTokenSwapRepository) {}

  /**
   * Starts the cashu token receive process by creating a new token swap and updating the account keyset counter.
   * @returns The created token swap and updatedaccount.
   * @throws An error if creating the swap fails.
   */
  async create({
    userId,
    token,
    account,
    reversedTransactionId,
  }: {
    /**
     * The id of the user that is creating the swap.
     */
    userId: string;
    /**
     * The token to receive.
     */
    token: Token;
    /**
     * The account to receive the proofs into.
     */
    account: CashuAccount;
    /**
     * The id of the transaction that this swap is reversing.
     */
    reversedTransactionId?: string;
  }): Promise<{
    swap: CashuTokenSwap;
    account: CashuAccount;
  }> {
    if (!areMintUrlsEqual(account.mintUrl, token.mint)) {
      throw new Error('Cannot swap a token to a different mint');
    }

    const inputAmount = tokenToMoney(token);
    const currency = inputAmount.currency;

    if (currency !== account.currency) {
      throw new Error('Cannot swap a token to a different currency.');
    }

    const wallet = account.wallet;

    const keys = await wallet.getKeys();
    const fee = wallet.getFeesForProofs(token.proofs);
    const amountToReceive = sumProofs(token.proofs) - fee;

    if (amountToReceive <= 0) {
      throw new Error('Token is too small to claim.');
    }

    const cashuUnit = getCashuUnit(currency);
    const feeAmount = new Money({
      amount: fee,
      currency: currency,
      unit: cashuUnit,
    });
    const receiveAmount = new Money({
      amount: amountToReceive,
      currency: currency,
      unit: cashuUnit,
    });

    const outputAmounts = getOutputAmounts(amountToReceive, keys);

    return await this.tokenSwapRepository.create({
      token,
      userId,
      accountId: account.id,
      keysetId: wallet.keysetId,
      inputAmount,
      cashuReceiveFee: feeAmount,
      receiveAmount,
      outputAmounts,
      reversedTransactionId,
    });
  }

  /**
   * Completes the token swap by executing the swap with the mint and storing the output proofs.
   * If the token swap is already completed, it's a no-op that returns back passed token swap, account and an empty list of added proof ids.
   * If the call to the mint to swap the proofs fails because the token is already claimed, then the token swap is failed and the account is not updated.
   * @param account The account to receive the proofs into.
   * @param tokenSwap The token swap to complete.
   * @returns The completed or failed token swap, account with the updated proofs (if the swap was completed) and a list of added proof ids (empty if the swap was failed).
   * @throws An error if the token swap is not pending or if completing the swap fails.
   */
  async completeSwap(
    account: CashuAccount,
    tokenSwap: CashuTokenSwap,
  ): Promise<{
    swap: CashuTokenSwap;
    account: CashuAccount;
    addedProofs: string[];
  }> {
    if (tokenSwap.state === 'COMPLETED') {
      return { swap: tokenSwap, account, addedProofs: [] };
    }

    if (tokenSwap.state !== 'PENDING') {
      throw new Error('Token swap is not pending');
    }

    const wallet = account.wallet;

    const { keysetId, keysetCounter, receiveAmount, outputAmounts } = tokenSwap;

    const keys = await wallet.getKeys(keysetId);
    const outputData = OutputData.createDeterministicData(
      receiveAmount.toNumber(getCashuUnit(receiveAmount.currency)),
      wallet.seed,
      keysetCounter,
      keys,
      outputAmounts,
    );

    try {
      const newProofs = await this.swapProofs(wallet, tokenSwap, outputData);

      return await this.tokenSwapRepository.completeTokenSwap({
        tokenHash: tokenSwap.tokenHash,
        userId: tokenSwap.userId,
        proofs: newProofs,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'TOKEN_ALREADY_CLAIMED') {
        const failedTokenSwap = await this.tokenSwapRepository.fail({
          tokenHash: tokenSwap.tokenHash,
          userId: tokenSwap.userId,
          reason: 'Token already claimed',
        });
        return { swap: failedTokenSwap, account, addedProofs: [] };
      }

      throw error;
    }
  }

  private async swapProofs(
    wallet: CashuWallet,
    tokenSwap: CashuTokenSwap,
    outputData: OutputData[],
  ) {
    try {
      const { send: newProofs } = await wallet.swap(
        tokenSwap.receiveAmount.toNumber(
          getCashuUnit(tokenSwap.receiveAmount.currency),
        ),
        tokenSwap.tokenProofs,
        {
          outputData: { send: outputData },
        },
      );
      return newProofs;
    } catch (error) {
      if (
        error instanceof MintOperationError &&
        ([
          CashuErrorCodes.OUTPUT_ALREADY_SIGNED,
          CashuErrorCodes.TOKEN_ALREADY_SPENT,
        ].includes(error.code) ||
          // Nutshell mint implementation did not conform to the spec up until version 0.16.5 (see https://github.com/cashubtc/nutshell/pull/693)
          // so for earlier versions we need to check the message.
          error.message
            .toLowerCase()
            .includes('outputs have already been signed before'))
      ) {
        const { proofs } = await wallet.restore(
          tokenSwap.keysetCounter,
          tokenSwap.outputAmounts.length,
          {
            keysetId: tokenSwap.keysetId,
          },
        );

        if (
          error.code === CashuErrorCodes.TOKEN_ALREADY_SPENT &&
          proofs.length === 0
        ) {
          // If token is spent and we could not restore proofs, then we know someone else has claimed this token.
          throw new Error('TOKEN_ALREADY_CLAIMED');
        }

        // TODO: make sure these proofs are not already in our balance and that they are not spent
        return proofs;
      }
      throw error;
    }
  }
}

export function useCashuTokenSwapService() {
  const tokenSwapRepository = useCashuTokenSwapRepository();
  return new CashuTokenSwapService(tokenSwapRepository);
}
