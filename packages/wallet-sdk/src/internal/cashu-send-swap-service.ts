/**
 * Cashu TOKEN-send SERVICE — Slice 3 / PR5b. The idempotent service primitives for a
 * `CashuSendSwap`'s lifecycle, including the user-initiated `reverse` (decision 8).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/send/cashu-send-swap-service.ts`. Master's `CashuSendSwapService`
 * is a plain class (only the `useCashuSendSwapService()` factory couples it to React); lifted
 * near-verbatim, dropping the factory and taking the SDK {@link CashuSendSwapRepository} +
 * {@link CashuReceiveSwapService} (the latter only for {@link reverse}).
 *
 * `swapForProofsToSend`'s `wallet.restore` recovery (on OUTPUT_ALREADY_SIGNED / TOKEN_ALREADY_SPENT)
 * is the stale-proof / re-issue protection — preserved verbatim. {@link reverse} = the public,
 * user-initiated reclaim of a PENDING token send: it creates a cashu RECEIVE swap pulling
 * `proofsToSend` back, tagged `reversedTransactionId` (lands REVERSED DB-side; no orchestrator
 * auto-reverse).
 *
 * @module
 */
import {
  MintOperationError,
  OutputData,
  type Proof,
  type Wallet,
} from '@cashu/cashu-ts';
import { CashuErrorCodes } from './cashu-error-codes';
import type { CashuReceiveSwapService } from './cashu-receive-swap-service';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';
import { getDefaultUnit } from '../../../../apps/web-wallet/app/features/shared/currencies';
import {
  getCashuProtocolUnit,
  getCashuUnit,
  getTokenHash,
  splitAmount,
  sumProofs,
  toProof,
} from './lib-cashu-quotes';
import type { ExtendedCashuWallet } from './lib-cashu-wallet';
import { DomainError } from '../errors';
import type { CashuAccount, CashuProof } from '../types/account';
import type { CashuSendSwap } from '../types/cashu';
import { Money } from '../types/money';

/** The estimated token-swap quote returned before the swap is persisted (master verbatim). */
export type CashuSwapQuote = {
  amountRequested: Money;
  senderPaysFee: boolean;
  cashuReceiveFee: Money;
  cashuSendFee: Money;
  totalAmount: Money;
  totalFee: Money;
  amountToSend: Money;
};

/** Idempotent service primitives for a cashu token-send swap. */
export class CashuSendSwapService {
  constructor(
    private readonly cashuSendSwapRepository: CashuSendSwapRepository,
    private readonly cashuReceiveSwapService: CashuReceiveSwapService,
  ) {}

  /**
   * Estimate the swap fees for sending `amount` from the account. Master verbatim.
   *
   * @throws Error/DomainError on currency mismatch or insufficient balance.
   */
  async getQuote({
    account,
    amount,
    senderPaysFee,
  }: {
    account: CashuAccount;
    amount: Money;
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
      new Money({ amount: num, currency: amount.currency, unit: cashuUnit });

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
   * Create (persist) a token-send swap. If the account has exact proofs the swap is created
   * PENDING (with a token hash); otherwise DRAFT (with output amounts for the swap). Master verbatim.
   *
   * @throws Error if the account does not have enough balance.
   */
  async create({
    userId,
    account,
    amount,
    senderPaysFee,
  }: {
    userId: string;
    account: CashuAccount;
    amount: Money;
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
      const keyset = wallet.getKeyset();
      keysetId = keyset.id;
      const amountToKeep =
        sumProofs(inputProofs) - totalAmountToSend - cashuSendFee;
      outputAmounts = {
        send: splitAmount(totalAmountToSend, keyset.keys),
        change: splitAmount(amountToKeep, keyset.keys),
      };
    }

    const toMoney = (num: number) =>
      new Money({ amount: num, currency: amount.currency, unit: cashuUnit });

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

  /**
   * Swap the input proofs for the exact proofs-to-send (DRAFT → PENDING), recovering via
   * `wallet.restore` if the mint reports the outputs already signed. Master verbatim.
   */
  async swapForProofsToSend({
    account,
    swap,
  }: {
    account: CashuAccount;
    swap: CashuSendSwap;
  }) {
    if (swap.state !== 'DRAFT') {
      throw new Error('Swap is not DRAFT');
    }
    if (swap.accountId !== account.id) {
      throw new Error('Swap does not belong to account');
    }

    const wallet = account.wallet;

    await wallet.keyChain.ensureKeysetKeys(swap.keysetId);
    const keyset = wallet.getKeyset(swap.keysetId);
    const currency = swap.amountToSend.currency;
    const cashuUnit = getCashuUnit(currency);
    const sendAmount = swap.amountToSend.toNumber(cashuUnit);
    const sendOutputData = OutputData.createDeterministicData(
      sendAmount,
      wallet.seed,
      swap.keysetCounter,
      keyset,
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
      keyset,
      swap.outputAmounts.change,
    );

    const { send: proofsToSend, keep: changeProofs } = await this.swapProofs(
      wallet,
      swap,
      { keep: keepOutputData, send: sendOutputData },
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

  /** Mark the swap COMPLETED. No-op if already COMPLETED. Master verbatim. */
  async complete(swap: CashuSendSwap) {
    if (swap.state === 'COMPLETED') {
      return;
    }
    if (swap.state !== 'PENDING') {
      throw new Error(`Swap is not PENDING. Current state: ${swap.state}`);
    }
    return this.cashuSendSwapRepository.complete(swap.id);
  }

  /** Fail a DRAFT swap. No-op if already FAILED. Master verbatim. */
  async fail(swap: CashuSendSwap, reason: string) {
    if (swap.state === 'FAILED') {
      return;
    }
    if (swap.state !== 'DRAFT') {
      throw new Error(`Swap is not DRAFT. Current state: ${swap.state}`);
    }
    return this.cashuSendSwapRepository.fail({ swapId: swap.id, reason });
  }

  /**
   * Reverse a PENDING token send (decision 8): create a cashu RECEIVE swap pulling
   * `proofsToSend` back into the account, tagged `reversedTransactionId`. No-op if already
   * REVERSED. Master verbatim.
   *
   * @throws Error if the swap is not PENDING or does not belong to the account.
   */
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

  /**
   * Select + price the input proofs for a send (sender pays fees). Master verbatim.
   *
   * @throws Error if sender does not pay fees (unimplemented) or DomainError on insufficient balance.
   */
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
        currency,
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
        currency,
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

  /**
   * Perform the mint swap for the DRAFT proofs-to-send, recovering minted proofs via
   * `wallet.restore` when the mint reports the outputs already signed/spent. Master verbatim.
   */
  private async swapProofs(
    wallet: Wallet,
    swap: CashuSendSwap & { state: 'DRAFT' },
    outputData: { keep: OutputData[]; send: OutputData[] },
  ) {
    const amountToSend = swap.amountToSend.toNumber(
      getCashuUnit(swap.amountToSend.currency),
    );

    try {
      return await wallet.ops
        .send(
          amountToSend,
          swap.inputProofs.map((p) => toProof(p)),
        )
        .keyset(swap.keysetId)
        .asCustom(outputData.send)
        .keepAsCustom(outputData.keep)
        .run();
    } catch (error) {
      if (
        error instanceof MintOperationError &&
        ([
          CashuErrorCodes.OUTPUT_ALREADY_SIGNED,
          CashuErrorCodes.TOKEN_ALREADY_SPENT,
        ].includes(error.code) ||
          // Nutshell < 0.16.5 did not conform to the spec (cashubtc/nutshell#693), so for
          // earlier versions we also check the message.
          error.message
            .toLowerCase()
            .includes('outputs have already been signed before'))
      ) {
        const totalOutputCount =
          outputData.send.length + outputData.keep.length;
        const { proofs } = await wallet.restore(
          swap.keysetCounter,
          totalOutputCount,
          { keysetId: swap.keysetId },
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
