import {
  MintOperationError,
  OutputData,
  type Proof,
  type Token,
} from '@cashu/cashu-ts';
import type { CashuAccount } from '~/features/accounts/account';
import {
  CashuErrorCodes,
  type ExtendedCashuWallet,
  amountsFromOutputData,
  getCashuProtocolUnit,
  getCashuUnit,
  isCashuError,
  sumProofs,
  validateTokenSpendingConditions,
} from '~/lib/cashu';
import { createDeterministicP2PKData } from '~/lib/cashu/crypto';
import type { SpendingConditionData, UnlockingData } from '~/lib/cashu/types';
import { Money } from '~/lib/money';
import {
  type CashuTokenSwapService,
  useCashuTokenSwapService,
} from '../receive/cashu-token-swap-service';
import { getTokenHash } from '../shared/cashu';
import { getDefaultUnit } from '../shared/currencies';
import { DomainError } from '../shared/error';
import type { CashuSendSwap } from './cashu-send-swap';
import {
  type CashuSendSwapRepository,
  useCashuSendSwapRepository,
} from './cashu-send-swap-repository';

export type CashuSwapQuote = {
  amountRequested: Money;
  senderPaysFee: boolean;
  cashuReceiveFee: Money;
  cashuSendFee: Money;
  totalAmount: Money;
  totalFee: Money;
  amountToSend: Money;
};

export class CashuSendSwapService {
  constructor(
    private readonly cashuSendSwapRepository: CashuSendSwapRepository,
    private readonly cashuTokenSwapService: CashuTokenSwapService,
  ) {}

  /**
   * Estimates the cashu swap fee that would be required to send the amount based on the account's proofs.
   * @throws Error if the account does not have enough balance
   */
  async getQuote({
    account,
    amount,
    senderPaysFee,
    requireSwap,
  }: {
    /** The account to send from. */
    account: CashuAccount;
    /** The amount to send in the account's currency */
    amount: Money;
    /** Whether the sender pays the fee for the swap by including the fee in the proofs to send */
    senderPaysFee: boolean;
    /**
     * Whether this operatioon will require a swap whether there are exact proofs or not.
     * If true, then always perform a swap to get the proofs to send.
     */
    requireSwap: boolean;
  }): Promise<CashuSwapQuote> {
    if (account.currency !== amount.currency) {
      throw new Error(
        'Currency mismatch. Account currency to send from must match the amount to send currency.',
      );
    }

    const cashuUnit = getCashuUnit(account.currency);
    const amountNumber = amount.toNumber(cashuUnit);
    const wallet = account.wallet;

    const { cashuReceiveFee, cashuSendFee } = await this.prepareProofsAndFee(
      wallet,
      account.proofs,
      amount,
      senderPaysFee,
      requireSwap,
    );

    const toMoney = (num: number) =>
      new Money({
        amount: num,
        currency: amount.currency,
        unit: cashuUnit,
      });

    return {
      amountRequested: amount,
      amountToSend: toMoney(amountNumber + cashuReceiveFee),
      totalAmount: toMoney(amountNumber + cashuReceiveFee + cashuSendFee),
      totalFee: toMoney(cashuReceiveFee + cashuSendFee),
      senderPaysFee,
      cashuReceiveFee: toMoney(cashuReceiveFee),
      cashuSendFee: toMoney(cashuSendFee),
    };
  }

  /**
   * @throws Error if the account does not have enough balance
   */
  async create({
    userId,
    account,
    amount,
    senderPaysFee,
    spendingConditionData,
    unlockingData,
  }: {
    /** The id of the user creating the swap */
    userId: string;
    /** The account to send from.  */
    account: CashuAccount;
    /** The amount to send in the account's currency */
    amount: Money;
    /** Whether the sender pays the fee for the swap by including the fee in the proofs to send */
    senderPaysFee: boolean;
    spendingConditionData?: SpendingConditionData;
    unlockingData?: UnlockingData;
  }): Promise<CashuSendSwap> {
    if (account.currency !== amount.currency) {
      throw new Error(
        'Currency mismatch. Account currency to send from must match the amount to send currency.',
      );
    }

    const cashuUnit = getCashuUnit(account.currency);
    const amountNumber = amount.toNumber(cashuUnit);

    const wallet = account.wallet;

    const {
      keep: accountProofsToKeep,
      send,
      cashuReceiveFee,
      cashuSendFee,
    } = await this.prepareProofsAndFee(
      wallet,
      account.proofs,
      amount,
      senderPaysFee,
      spendingConditionData !== undefined,
    );

    const totalAmountToSend = amountNumber + cashuReceiveFee;

    let proofsToSend: Proof[] | undefined;
    let tokenHash: string | undefined;
    let sendOutputData: OutputData[] = [];
    let keepOutputData: OutputData[] = [];
    let sendKeysetCounter: number | undefined;
    let keysetId: string | undefined;

    const haveExactProofs = sumProofs(send) === totalAmountToSend;
    const requiresSwap = !haveExactProofs || spendingConditionData;

    if (requiresSwap) {
      const keys = await wallet.getKeys();
      keysetId = keys.id;
      sendKeysetCounter = account.keysetCounters[keysetId] ?? 0;
      sendOutputData = await this.createOutputData(wallet, {
        amount: totalAmountToSend,
        counter: sendKeysetCounter,
        spendingConditionData,
      });

      const amountToKeep = sumProofs(send) - totalAmountToSend - cashuSendFee;
      const keepKeysetCounter = sendKeysetCounter + sendOutputData.length;
      keepOutputData = await this.createOutputData(wallet, {
        amount: amountToKeep,
        counter: keepKeysetCounter,
        spendingConditionData,
      });
    } else {
      proofsToSend = send;
      tokenHash = await getTokenHash({
        mint: account.mintUrl,
        proofs: proofsToSend,
        unit: getCashuProtocolUnit(amount.currency),
      });
    }

    const toMoney = (num: number) =>
      new Money({
        amount: num,
        currency: amount.currency,
        unit: cashuUnit,
      });

    return this.cashuSendSwapRepository.create({
      accountId: account.id,
      accountVersion: account.version,
      userId,
      inputProofs: send,
      proofsToSend,
      accountProofs: accountProofsToKeep,
      amountRequested: amount,
      amountToSend: toMoney(totalAmountToSend),
      cashuSendFee: toMoney(cashuSendFee),
      cashuReceiveFee: toMoney(cashuReceiveFee),
      totalAmount: toMoney(totalAmountToSend + cashuSendFee),
      keysetId,
      keysetCounter: sendKeysetCounter,
      tokenHash,
      spendingConditionData,
      unlockingData,
      outputAmounts: {
        send: amountsFromOutputData(sendOutputData),
        keep: amountsFromOutputData(keepOutputData),
      },
    });
  }

  async swapForProofsToSend({
    account,
    swap,
  }: { account: CashuAccount; swap: CashuSendSwap }) {
    if (swap.state !== 'DRAFT') {
      throw new Error('Swap is not DRAFT');
    }
    if (swap.accountId !== account.id) {
      throw new Error('Swap does not belong to account');
    }

    const wallet = account.wallet;

    const sendAmount = swap.amountToSend.toNumber(getCashuUnit(swap.currency));
    const sendOutputData = await this.createOutputData(wallet, {
      amount: sendAmount,
      counter: swap.keysetCounter,
      spendingConditionData: swap.spendingConditionData,
      customSplit: swap.outputAmounts.send,
    });

    const amountToKeep =
      sumProofs(swap.inputProofs) -
      sendAmount -
      swap.cashuSendFee.toNumber(getCashuUnit(swap.currency));
    const keepOutputData = await this.createOutputData(wallet, {
      amount: amountToKeep,
      counter: swap.keysetCounter + sendOutputData.length,
      customSplit: swap.outputAmounts.keep,
    });

    const { send: proofsToSend, keep: newProofsToKeep } = await this.swapProofs(
      wallet,
      swap,
      {
        keep: keepOutputData,
        send: sendOutputData,
      },
    );

    if (proofsToSend.length === 0) {
      console.error('No proofs to send', {
        swap,
        account,
      });
      // this can happen if the input proofs were already spent by another wallet
      return this.fail(swap, 'Could not restore proofs to send');
    }

    const tokenHash = await getTokenHash({
      mint: account.mintUrl,
      proofs: proofsToSend,
      unit: getCashuProtocolUnit(swap.amountToSend.currency),
    });

    const accountProofs = [...account.proofs, ...newProofsToKeep];

    await this.cashuSendSwapRepository.commitProofsToSend({
      swap,
      accountVersion: account.version,
      proofsToSend,
      accountProofs,
      tokenHash,
    });
  }

  async complete(swap: CashuSendSwap) {
    return this.cashuSendSwapRepository.complete({
      swapId: swap.id,
      swapVersion: swap.version,
    });
  }

  async fail(swap: CashuSendSwap, reason: string) {
    return this.cashuSendSwapRepository.fail({
      swapId: swap.id,
      swapVersion: swap.version,
      reason,
    });
  }

  async reverse(swap: CashuSendSwap, account: CashuAccount) {
    if (swap.state !== 'PENDING') {
      throw new Error('Swap is not PENDING');
    }
    if (swap.accountId !== account.id) {
      throw new Error('Swap does not belong to account');
    }

    const token: Token = {
      mint: account.mintUrl,
      proofs: swap.proofsToSend,
      unit: getCashuProtocolUnit(swap.currency),
    };

    const unlockingData = swap.unlockingData ?? undefined;
    if (unlockingData) {
      const result = validateTokenSpendingConditions(token, unlockingData);
      if (!result.success) {
        throw new Error(result.error);
      }
    }

    return this.cashuTokenSwapService.create({
      account,
      userId: swap.userId,
      token,
      reversedTransactionId: swap.transactionId,
      unlockingData,
    });
  }

  private async prepareProofsAndFee(
    wallet: ExtendedCashuWallet,
    allProofs: Proof[],
    requestedAmount: Money,
    includeFeesInSendAmount: boolean,
    requireSwap: boolean,
  ): Promise<{
    keep: Proof[];
    send: Proof[];
    cashuSendFee: number;
    cashuReceiveFee: number;
  }> {
    if (includeFeesInSendAmount) {
      // If we want to do fee calculation, then the keys are required
      await wallet.getKeys();
    } else {
      throw new Error(
        'Sender must pay fees - this feature is not yet implemented',
      );
    }

    const currency = requestedAmount.currency;
    const cashuUnit = getCashuUnit(currency);
    const requestedAmountNumber = requestedAmount.toNumber(cashuUnit);

    let { keep, send } = wallet.selectProofsToSend(
      allProofs,
      requestedAmountNumber,
      includeFeesInSendAmount,
    );
    const feeToSwapSelectedProofs = wallet.getFeesForProofs(send);

    let proofAmountSelected = sumProofs(send);
    const amountToSend = requestedAmountNumber + feeToSwapSelectedProofs;

    console.debug('proofSelection', {
      selectedProofs: send.map((p) => p.amount),
      proofAmountSelected,
      amountToSend,
      feeToSwapSelectedProofs,
    });

    if (proofAmountSelected === amountToSend) {
      if (requireSwap && feeToSwapSelectedProofs > 0) {
        // This is a current limitation of the selectProofsToSend function.
        // selectProofsToSend will correctly consider receiveSwapFees, but
        // there is no wasy to make it select enough proofs to swap in the case
        // of adding spending conditions to the proofs where a swap is required.
        throw new DomainError(
          'Unable to select proofs to swap. Try a different amount or use amint with no fees.',
        );
      }
      return {
        keep,
        send,
        cashuSendFee: 0,
        cashuReceiveFee: feeToSwapSelectedProofs,
      };
    }

    const estimatedFeeToReceive =
      wallet.getFeesEstimateToReceiveAtLeast(amountToSend);

    if (proofAmountSelected < amountToSend) {
      const totalAmount = new Money({
        amount: requestedAmountNumber + estimatedFeeToReceive,
        currency: currency,
        unit: cashuUnit,
      });
      const unit = getDefaultUnit(currency);

      throw new DomainError(
        `Insufficient balance. Total amount including fees is ${totalAmount.toLocaleString({ unit })}.`,
      );
    }

    ({ keep, send } = wallet.selectProofsToSend(
      allProofs,
      requestedAmountNumber + estimatedFeeToReceive,
      includeFeesInSendAmount,
    ));
    proofAmountSelected = sumProofs(send);

    const cashuSendFee = wallet.getFeesForProofs(send);
    const cashuReceiveFee = estimatedFeeToReceive;

    if (
      proofAmountSelected <
      requestedAmountNumber + cashuSendFee + cashuReceiveFee
    ) {
      const totalAmount = new Money({
        amount: requestedAmountNumber + cashuSendFee + cashuReceiveFee,
        currency: currency,
        unit: cashuUnit,
      });
      const unit = getDefaultUnit(currency);

      throw new DomainError(
        `Insufficient balance. Total amount including fees is ${totalAmount.toLocaleString({ unit })}.`,
      );
    }

    console.debug('fees', {
      cashuSendFee,
      cashuReceiveFee,
    });

    return { keep, send, cashuSendFee, cashuReceiveFee };
  }

  private async swapProofs(
    wallet: ExtendedCashuWallet,
    swap: CashuSendSwap & { state: 'DRAFT' },
    outputData: {
      keep: OutputData[];
      send: OutputData[];
    },
  ) {
    const amountToSend = swap.amountToSend.toNumber(
      getCashuUnit(swap.currency),
    );

    try {
      await wallet.swap(amountToSend, swap.inputProofs, {
        outputData,
        keysetId: swap.keysetId,
      });
      // throw for now to trigger the restore path
      throw new MintOperationError(CashuErrorCodes.OUTPUT_ALREADY_SIGNED, '');
    } catch (error) {
      if (
        error instanceof MintOperationError &&
        isCashuError(error, [
          CashuErrorCodes.OUTPUT_ALREADY_SIGNED,
          CashuErrorCodes.TOKEN_ALREADY_SPENT,
        ])
      ) {
        return wallet.restoreFromOutputData(outputData, swap.keysetId);
      }

      throw error;
    }
  }

  private async createOutputData(
    wallet: ExtendedCashuWallet,
    {
      amount,
      counter,
      customSplit,
      spendingConditionData,
    }: {
      amount: number;
      counter: number;
      customSplit?: number[];
      spendingConditionData?: SpendingConditionData | null;
    },
  ) {
    const keys = await wallet.getKeys();
    if (!spendingConditionData) {
      return OutputData.createDeterministicData(
        amount,
        wallet.seed,
        counter,
        keys,
        customSplit,
      );
    }
    if (spendingConditionData.kind === 'P2PK') {
      return createDeterministicP2PKData(
        amount,
        wallet.seed,
        counter,
        keys,
        spendingConditionData,
        customSplit,
      );
    }
    throw new Error('Unsupported spending condition data', {
      cause: spendingConditionData,
    });
  }
}

export function useCashuSendSwapService() {
  const cashuSendSwapRepository = useCashuSendSwapRepository();
  const cashuTokenSwapService = useCashuTokenSwapService();
  return new CashuSendSwapService(
    cashuSendSwapRepository,
    cashuTokenSwapService,
  );
}
