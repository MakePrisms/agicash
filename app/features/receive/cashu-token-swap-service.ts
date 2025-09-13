import {
  type CashuWallet,
  MintOperationError,
  OutputData,
  type Token,
} from '@cashu/cashu-ts';
import {
  CashuErrorCodes,
  amountsFromOutputData,
  areMintUrlsEqual,
  isCashuError,
  sumProofs,
  validateTokenSpendingConditions,
} from '~/lib/cashu';
import type { UnlockingData } from '~/lib/cashu/types';
import { sum } from '~/lib/utils';
import type { CashuAccount } from '../accounts/account';
import { tokenToMoney } from '../shared/cashu';
import type { CashuTokenSwap } from './cashu-token-swap';
import {
  type CashuTokenSwapRepository,
  useCashuTokenSwapRepository,
} from './cashu-token-swap-repository';

export class CashuTokenSwapService {
  constructor(private readonly tokenSwapRepository: CashuTokenSwapRepository) {}

  async create({
    userId,
    token,
    account,
    reversedTransactionId,
    unlockingData,
  }: {
    userId: string;
    token: Token;
    account: CashuAccount;
    reversedTransactionId?: string;
    unlockingData?: UnlockingData;
  }) {
    if (!areMintUrlsEqual(account.mintUrl, token.mint)) {
      throw new Error('Cannot swap a token to a different mint');
    }

    const result = validateTokenSpendingConditions(token, unlockingData);
    if (!result.success) {
      throw new Error(result.error);
    }

    const amount = tokenToMoney(token);

    if (amount.currency !== account.currency) {
      throw new Error('Cannot swap a token to a different currency.');
    }

    const wallet = account.wallet;

    const keys = await wallet.getKeys();
    const counter = account.keysetCounters[wallet.keysetId] ?? 0;
    const fee = wallet.getFeesForProofs(token.proofs);
    const amountToReceive = sumProofs(token.proofs) - fee;

    if (amountToReceive <= 0) {
      throw new Error('Token is too small to claim.');
    }

    const outputData = OutputData.createDeterministicData(
      amountToReceive,
      wallet.seed,
      counter,
      keys,
    );
    const outputAmounts = amountsFromOutputData(outputData);

    const tokenSwap = await this.tokenSwapRepository.create({
      token,
      userId,
      accountId: account.id,
      keysetId: wallet.keysetId,
      keysetCounter: counter,
      inputAmount: sumProofs(token.proofs),
      outputAmounts,
      cashuReceiveFee: fee,
      accountVersion: account.version,
      reversedTransactionId,
      unlockingData,
    });

    return tokenSwap;
  }

  async completeSwap(account: CashuAccount, tokenSwap: CashuTokenSwap) {
    if (tokenSwap.state === 'COMPLETED') {
      return;
    }

    if (tokenSwap.state !== 'PENDING') {
      throw new Error('Token swap is not pending');
    }

    const wallet = account.wallet;

    const { keysetId, keysetCounter } = tokenSwap;
    const amountToReceive = sum(tokenSwap.outputAmounts);

    const outputData = OutputData.createDeterministicData(
      amountToReceive,
      wallet.seed,
      keysetCounter,
      await wallet.getKeys(keysetId),
      tokenSwap.outputAmounts,
    );

    try {
      const newProofs = await this.swapProofs(wallet, tokenSwap, outputData);
      const allProofs = [...account.proofs, ...newProofs];

      await this.tokenSwapRepository.completeTokenSwap({
        tokenHash: tokenSwap.tokenHash,
        userId: tokenSwap.userId,
        swapVersion: tokenSwap.version,
        proofs: allProofs,
        accountVersion: account.version,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'TOKEN_ALREADY_CLAIMED') {
        await this.tokenSwapRepository.fail({
          tokenHash: tokenSwap.tokenHash,
          userId: tokenSwap.userId,
          version: tokenSwap.version,
          reason: 'Token already claimed',
        });
      } else if (
        error instanceof Error &&
        error.message === 'TOKEN_UNSPENDABLE'
      ) {
        // TODO: we should delete the swap from the database here or chang ehow we hand the
        // unique constraint on the token hash. Currenlty, now that this token hash
        // is in the database, we can never try to claim it again
        await this.tokenSwapRepository.fail({
          tokenHash: tokenSwap.tokenHash,
          userId: tokenSwap.userId,
          version: tokenSwap.version,
          reason: 'Token is unspendable',
        });
        throw error;
      } else {
        throw error;
      }
    }
  }

  private async swapProofs(
    wallet: CashuWallet,
    tokenSwap: CashuTokenSwap,
    outputData: OutputData[],
  ) {
    try {
      const amountToReceive = sum(tokenSwap.outputAmounts);
      const privkey =
        tokenSwap.unlockingData?.kind === 'P2PK'
          ? tokenSwap.unlockingData.signingKeys[0]
          : undefined;

      const { send: newProofs } = await wallet.swap(
        amountToReceive,
        tokenSwap.tokenProofs,
        {
          outputData: { send: outputData },
          privkey,
        },
      );

      return newProofs;
    } catch (error) {
      if (error instanceof MintOperationError) {
        if (isCashuError(error, [CashuErrorCodes.WITNESS_MISSING_P2PK])) {
          // The swap was created with invalid unlocking data. In the current state,
          // the token cannot be claimed.
          throw new Error('TOKEN_UNSPENDABLE');
        }

        if (
          isCashuError(error, [
            CashuErrorCodes.OUTPUT_ALREADY_SIGNED,
            CashuErrorCodes.TOKEN_ALREADY_SPENT,
          ])
        ) {
          // The swap failed because the mint already issued signatures for our
          // specified outputs. We will now try to recover the swap by restoring the
          // blinded signatures from the mint.
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

          // TODO: make sure these proofs are not already in our balance and that they are in the UNSPENT state.
          // We should never put pending nor spent proofs in our main wallet balance.
          return proofs;
        }
      }
      throw error;
    }
  }
}

export function useCashuTokenSwapService() {
  const tokenSwapRepository = useCashuTokenSwapRepository();
  return new CashuTokenSwapService(tokenSwapRepository);
}
