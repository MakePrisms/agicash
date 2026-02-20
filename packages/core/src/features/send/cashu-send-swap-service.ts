import {
  type CashuWallet,
  MintOperationError,
  OutputData,
  type Proof,
} from '@cashu/cashu-ts';
import {
  CashuErrorCodes,
  type ExtendedCashuWallet,
  getCashuProtocolUnit,
  getCashuUnit,
  getOutputAmounts,
  sumProofs,
} from '../../lib/cashu';
import { Money } from '../../lib/money';
import type { CashuAccount } from '../accounts/account';
import { type CashuProof, toProof } from '../accounts/cashu-account';
import type { CashuReceiveSwapService } from '../receive/cashu-receive-swap-service';
import { getTokenHash } from '../shared/cashu';
import { getDefaultUnit } from '../shared/currencies';
import { DomainError } from '../shared/error';
import type { CashuSendSwap } from './cashu-send-swap';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';

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
    private readonly cashuReceiveSwapService: CashuReceiveSwapService,
  ) {}

  /**
   * Estimates the cashu swap fee that would be required to send the amount based on the account's proofs.
   * @throws Error if the account does not have enough balance
   */
  async getQuote({
    account,
    amount,
    senderPaysFee,
  }: {
    /** The account to send from. */
    account: CashuAccount;
    /** The amount to send in the account's currency */
    amount: Money;
    /** Whether the sender pays the fee for the swap by including the fee in the proofs to send */
    senderPaysFee: boolean;
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
  }: {
    /** The id of the user creating the swap */
    userId: string;
    /** The account to send from.  */
    account: CashuAccount;
    /** The amount to send in the account's currency */
    amount: Money;
    /** Whether the sender pays the fee for the swap by including the fee in the proofs to send */
    senderPaysFee: boolean;
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
      send: inputProofs,
      cashuReceiveFee,
      cashuSendFee,
    } = await this.prepareProofsAndFee(
      wallet,
      account.proofs,
      amount,
      senderPaysFee,
    );

    const totalAmountToSend = amountNumber + cashuReceiveFee;

    let tokenHash: string | undefined;
    let keysetId: string | undefined;
    let outputAmounts: { send: number[]; change: number[] } | undefined;

    const haveExactProofs = sumProofs(inputProofs) === totalAmountToSend;
    if (haveExactProofs) {
      tokenHash = await getTokenHash({
        mint: account.mintUrl,
        proofs: inputProofs.map((p) => toProof(p)),
        unit: getCashuProtocolUnit(amount.currency),
      });
    } else {
      const keys = await wallet.getKeys();
      keysetId = keys.id;
      const amountToKeep =
        sumProofs(inputProofs) - totalAmountToSend - cashuSendFee;
      outputAmounts = {
        send: getOutputAmounts(totalAmountToSend, keys),
        change: getOutputAmounts(amountToKeep, keys),
      };
    }

    const toMoney = (num: number) =>
      new Money({
        amount: num,
        currency: amount.currency,
        unit: cashuUnit,
      });

    return this.cashuSendSwapRepository.create({
      accountId: account.id,
      userId,
      tokenMintUrl: account.mintUrl,
      inputProofs,
      inputAmount: toMoney(sumProofs(inputProofs)),
      amountRequested: amount,
      amountToSend: toMoney(totalAmountToSend),
      cashuSendFee: toMoney(cashuSendFee),
      cashuReceiveFee: toMoney(cashuReceiveFee),
      totalAmount: toMoney(totalAmountToSend + cashuSendFee),
      tokenHash,
      keysetId,
      outputAmounts,
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

    const keys = await wallet.getKeys(swap.keysetId);
    const currency = swap.amountToSend.currency;
    const cashuUnit = getCashuUnit(currency);
    const sendAmount = swap.amountToSend.toNumber(cashuUnit);
    const sendOutputData = OutputData.createDeterministicData(
      sendAmount,
      wallet.seed,
      swap.keysetCounter,
      keys,
      swap.outputAmounts.send,
    );

    const amountToKeep =
      sumProofs(swap.inputProofs) -
      sendAmount -
      swap.cashuSendFee.toNumber(cashuUnit);
    const keepOutputData = OutputData.createDeterministicData(
      amountToKeep,
      wallet.seed,
      swap.keysetCounter + sendOutputData.length,
      keys,
      swap.outputAmounts.change,
    );

    const { send: proofsToSend, keep: changeProofs } = await this.swapProofs(
      wallet,
      swap,
      {
        keep: keepOutputData,
        send: sendOutputData,
      },
    );

    const tokenHash = await getTokenHash({
      mint: account.mintUrl,
      proofs: proofsToSend,
      unit: getCashuProtocolUnit(currency),
    });

    await this.cashuSendSwapRepository.commitProofsToSend({
      swap,
      proofsToSend,
      changeProofs,
      tokenHash,
    });
  }

  async complete(swap: CashuSendSwap) {
    if (swap.state === 'COMPLETED') {
      return;
    }

    if (swap.state !== 'PENDING') {
      throw new Error(`Swap is not PENDING. Current state: ${swap.state}`);
    }

    return this.cashuSendSwapRepository.complete(swap.id);
  }

  async fail(swap: CashuSendSwap, reason: string) {
    if (swap.state === 'FAILED') {
      return;
    }

    if (swap.state !== 'DRAFT') {
      throw new Error(`Swap is not DRAFT. Current state: ${swap.state}`);
    }

    return this.cashuSendSwapRepository.fail({
      swapId: swap.id,
      reason,
    });
  }

  async reverse(swap: CashuSendSwap, account: CashuAccount): Promise<void> {
    if (swap.state === 'REVERSED') {
      return;
    }

    if (swap.state !== 'PENDING') {
      throw new Error('Swap is not PENDING');
    }
    if (swap.accountId !== account.id) {
      throw new Error('Swap does not belong to account');
    }

    await this.cashuReceiveSwapService.create({
      account,
      userId: swap.userId,
      token: {
        mint: account.mintUrl,
        proofs: swap.proofsToSend.map((p) => toProof(p)),
        unit: getCashuProtocolUnit(swap.amountToSend.currency),
      },
      reversedTransactionId: swap.transactionId,
    });
  }

  private async prepareProofsAndFee(
    wallet: ExtendedCashuWallet,
    accountProofs: CashuProof[],
    requestedAmount: Money,
    includeFeesInSendAmount: boolean,
  ): Promise<{
    keep: CashuProof[];
    send: CashuProof[];
    cashuSendFee: number;
    cashuReceiveFee: number;
  }> {
    if (!includeFeesInSendAmount) {
      throw new Error(
        'Sender must pay fees - this feature is not yet implemented',
      );
    }

    if (includeFeesInSendAmount) {
      // If we want to do fee calculation, then the keys are required
      await wallet.getKeys();
    }

    const accountProofsMap = new Map<string, CashuProof>(
      accountProofs.map((p) => [p.secret, p]),
    );
    const toCashuProof = (p: Proof) => {
      const proof = accountProofsMap.get(p.secret);
      if (!proof) {
        throw new Error('Proof not found');
      }
      return proof;
    };

    const proofs = accountProofs.map((p) => toProof(p));
    const currency = requestedAmount.currency;
    const cashuUnit = getCashuUnit(currency);
    const requestedAmountNumber = requestedAmount.toNumber(cashuUnit);

    let { keep, send } = wallet.selectProofsToSend(
      proofs,
      requestedAmountNumber,
      includeFeesInSendAmount,
    );
    const feeToSwapSelectedProofs = wallet.getFeesForProofs(send);

    let proofAmountSelected = sumProofs(send);
    const amountToSend = requestedAmountNumber + feeToSwapSelectedProofs;

    if (proofAmountSelected === amountToSend) {
      return {
        keep: keep.map(toCashuProof),
        send: send.map(toCashuProof),
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
      proofs,
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

    return {
      keep: keep.map(toCashuProof),
      send: send.map(toCashuProof),
      cashuSendFee,
      cashuReceiveFee,
    };
  }

  private async swapProofs(
    wallet: CashuWallet,
    swap: CashuSendSwap & { state: 'DRAFT' },
    outputData: {
      keep: OutputData[];
      send: OutputData[];
    },
  ) {
    const amountToSend = swap.amountToSend.toNumber(
      getCashuUnit(swap.amountToSend.currency),
    );

    try {
      return await wallet.swap(
        amountToSend,
        swap.inputProofs.map((p) => toProof(p)),
        {
          outputData,
          keysetId: swap.keysetId,
        },
      );
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
        const totalOutputCount =
          outputData.send.length + outputData.keep.length;
        const { proofs } = await wallet.restore(
          swap.keysetCounter,
          totalOutputCount,
          {
            keysetId: swap.keysetId,
          },
        );

        const textDecoder = new TextDecoder();
        return {
          send: proofs.filter((o) =>
            outputData.send.some(
              (s) => textDecoder.decode(s.secret) === o.secret,
            ),
          ),
          keep: proofs.filter((o) =>
            outputData.keep.some(
              (s) => textDecoder.decode(s.secret) === o.secret,
            ),
          ),
        };
      }

      throw error;
    }
  }
}
