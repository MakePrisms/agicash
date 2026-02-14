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
import type { CashuReceiveSwap } from './cashu-receive-swap';
import {
  type CashuReceiveSwapRepository,
  useCashuReceiveSwapRepository,
} from './cashu-receive-swap-repository';

export class CashuReceiveSwapService {
  constructor(
    private readonly receiveSwapRepository: CashuReceiveSwapRepository,
  ) {}

  /**
   * Starts the cashu receive swap process by creating a new receive swap and updating the account keyset counter.
   * @returns The created receive swap and updated account.
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
    swap: CashuReceiveSwap;
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

    return await this.receiveSwapRepository.create({
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
   * Fails a cashu receive swap.
   * If the swap is already failed, it's a no-op that returns the passed swap.
   * @param swap The receive swap to fail.
   * @param reason The reason for the failure.
   * @returns The failed receive swap.
   * @throws An error if the swap is not in a PENDING state.
   */
  async fail(
    swap: CashuReceiveSwap,
    reason: string,
  ): Promise<CashuReceiveSwap> {
    if (swap.state === 'FAILED') {
      return swap;
    }

    if (swap.state !== 'PENDING') {
      throw new Error(
        `Cannot fail receive swap that is not pending. Current state: ${swap.state}`,
      );
    }

    return this.receiveSwapRepository.fail({
      tokenHash: swap.tokenHash,
      userId: swap.userId,
      reason,
    });
  }

  /**
   * Completes the receive swap by executing the swap with the mint and storing the output proofs.
   * If the receive swap is already completed, it's a no-op that returns back passed receive swap, account and an empty list of added proof ids.
   * If the call to the mint to swap the proofs fails because the token is already claimed, then the receive swap is failed and the account is not updated.
   * @param account The account to receive the proofs into.
   * @param receiveSwap The receive swap to complete.
   * @returns The completed or failed receive swap, account with the updated proofs (if the swap was completed) and a list of added proof ids (empty if the swap was failed).
   * @throws An error if the receive swap is not pending or if completing the swap fails.
   */
  async completeSwap(
    account: CashuAccount,
    receiveSwap: CashuReceiveSwap,
  ): Promise<{
    swap: CashuReceiveSwap;
    account: CashuAccount;
    addedProofs: string[];
  }> {
    if (receiveSwap.state === 'COMPLETED') {
      return { swap: receiveSwap, account, addedProofs: [] };
    }

    if (receiveSwap.state !== 'PENDING') {
      throw new Error('Receive swap is not pending');
    }

    const wallet = account.wallet;

    const {
      keysetId,
      keysetCounter,
      amountReceived: receiveAmount,
      outputAmounts,
    } = receiveSwap;

    const keys = await wallet.getKeys(keysetId);
    const outputData = OutputData.createDeterministicData(
      receiveAmount.toNumber(getCashuUnit(receiveAmount.currency)),
      wallet.seed,
      keysetCounter,
      keys,
      outputAmounts,
    );

    try {
      const newProofs = await this.swapProofs(wallet, receiveSwap, outputData);

      return await this.receiveSwapRepository.completeReceiveSwap({
        tokenHash: receiveSwap.tokenHash,
        userId: receiveSwap.userId,
        proofs: newProofs,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'TOKEN_ALREADY_CLAIMED') {
        const failedReceiveSwap = await this.fail(
          receiveSwap,
          'Token already claimed',
        );
        return { swap: failedReceiveSwap, account, addedProofs: [] };
      }

      throw error;
    }
  }

  private async swapProofs(
    wallet: CashuWallet,
    receiveSwap: CashuReceiveSwap,
    outputData: OutputData[],
  ) {
    try {
      const { send: newProofs } = await wallet.swap(
        receiveSwap.amountReceived.toNumber(
          getCashuUnit(receiveSwap.amountReceived.currency),
        ),
        receiveSwap.tokenProofs,
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
          receiveSwap.keysetCounter,
          receiveSwap.outputAmounts.length,
          {
            keysetId: receiveSwap.keysetId,
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

export function useCashuReceiveSwapService() {
  const receiveSwapRepository = useCashuReceiveSwapRepository();
  return new CashuReceiveSwapService(receiveSwapRepository);
}
