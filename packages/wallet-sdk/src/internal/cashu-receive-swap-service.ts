/**
 * Cashu same-mint token-claim SERVICE — Slice 3 / PR5b. The idempotent primitives for a
 * same-mint `CashuReceiveSwap` (claim a token into the account it originated from).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/receive/cashu-receive-swap-service.ts`. Master's
 * `CashuReceiveSwapService` is a plain class (only the `useCashuReceiveSwapService()` factory
 * couples it to React); lifted near-verbatim, taking the SDK {@link CashuReceiveSwapRepository}.
 *
 * `completeSwap`'s `wallet.restore` recovery (on OUTPUT_ALREADY_SIGNED / TOKEN_ALREADY_SPENT)
 * is the stale-proof / double-claim protection — preserved verbatim. The `CashuReceiveSwap`
 * type is INTERNAL (see the repo).
 *
 * @module
 */
import {
  MintOperationError,
  OutputData,
  type Token,
  type Wallet,
  splitAmount,
} from '@cashu/cashu-ts';
import { CashuErrorCodes } from './cashu-error-codes';
import type {
  CashuReceiveSwap,
  CashuReceiveSwapRepository,
} from './cashu-receive-swap-repository';
import {
  areMintUrlsEqual,
  getCashuUnit,
  sumProofs,
  tokenToMoney,
} from './lib-cashu-quotes';
import type { CashuAccount } from '../types/account';
import { Money } from '../types/money';

/** Idempotent service primitives for a same-mint cashu token claim. */
export class CashuReceiveSwapService {
  constructor(
    private readonly receiveSwapRepository: CashuReceiveSwapRepository,
  ) {}

  /**
   * Start a same-mint receive swap (create it + bump the account keyset counter). Master verbatim.
   *
   * @param params.reversedTransactionId - set when this swap is reversing a token send (decision 8).
   * @returns the created swap + updated account.
   * @throws Error on a cross-mint / cross-currency token, or a too-small token.
   */
  async create({
    userId,
    token,
    account,
    reversedTransactionId,
  }: {
    userId: string;
    token: Token;
    account: CashuAccount;
    reversedTransactionId?: string;
  }): Promise<{ swap: CashuReceiveSwap; account: CashuAccount }> {
    if (!areMintUrlsEqual(account.mintUrl, token.mint)) {
      throw new Error('Cannot swap a token to a different mint');
    }

    const inputAmount = tokenToMoney(token);
    const currency = inputAmount.currency;

    if (currency !== account.currency) {
      throw new Error('Cannot swap a token to a different currency.');
    }

    const wallet = account.wallet;

    const keyset = wallet.getKeyset();
    const fee = wallet.getFeesForProofs(token.proofs);
    const amountToReceive = sumProofs(token.proofs) - fee;

    if (amountToReceive <= 0) {
      throw new Error('Token is too small to claim.');
    }

    const cashuUnit = getCashuUnit(currency);
    const feeAmount = new Money({ amount: fee, currency, unit: cashuUnit });
    const receiveAmount = new Money({
      amount: amountToReceive,
      currency,
      unit: cashuUnit,
    });

    const outputAmounts = splitAmount(amountToReceive, keyset.keys);

    return this.receiveSwapRepository.create({
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
   * Fail a PENDING receive swap. No-op if already FAILED. Master verbatim.
   *
   * @throws Error if the swap is not PENDING.
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
   * Complete the receive swap by executing the mint swap + storing the output proofs.
   * No-op if already COMPLETED. If the mint reports the token already claimed, the swap is
   * failed instead of throwing. Master verbatim (`wallet.restore` recovery preserved).
   *
   * @returns the completed/failed swap, the updated account, and the added proof ids.
   * @throws Error if the swap is not pending or the mint swap fails non-recoverably.
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

    await wallet.keyChain.ensureKeysetKeys(keysetId);
    const keyset = wallet.getKeyset(keysetId);
    const outputData = OutputData.createDeterministicData(
      receiveAmount.toNumber(getCashuUnit(receiveAmount.currency)),
      wallet.seed,
      keysetCounter,
      keyset,
      outputAmounts,
    );

    try {
      const newProofs = await this.swapProofs(wallet, receiveSwap, outputData);
      return this.receiveSwapRepository.completeReceiveSwap({
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

  /**
   * Perform the mint swap for the token proofs, recovering minted proofs via `wallet.restore`
   * when the mint reports the outputs already signed/spent. Master verbatim.
   */
  private async swapProofs(
    wallet: Wallet,
    receiveSwap: CashuReceiveSwap,
    outputData: OutputData[],
  ) {
    try {
      return await wallet.ops
        .receive({
          mint: wallet.mint.mintUrl,
          proofs: receiveSwap.tokenProofs,
          unit: wallet.unit,
        })
        .asCustom(outputData)
        .run();
    } catch (error) {
      if (
        error instanceof MintOperationError &&
        ([
          CashuErrorCodes.OUTPUT_ALREADY_SIGNED,
          CashuErrorCodes.TOKEN_ALREADY_SPENT,
        ].includes(error.code) ||
          error.message
            .toLowerCase()
            .includes('outputs have already been signed before'))
      ) {
        const { proofs } = await wallet.restore(
          receiveSwap.keysetCounter,
          receiveSwap.outputAmounts.length,
          { keysetId: receiveSwap.keysetId },
        );

        if (
          error.code === CashuErrorCodes.TOKEN_ALREADY_SPENT &&
          proofs.length === 0
        ) {
          // Token spent + nothing to restore ⇒ someone else claimed it.
          throw new Error('TOKEN_ALREADY_CLAIMED');
        }

        return proofs;
      }
      throw error;
    }
  }
}
