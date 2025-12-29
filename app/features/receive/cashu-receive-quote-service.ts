import {
  MintOperationError,
  type MintQuoteResponse,
  MintQuoteState,
  OutputData,
  type Proof,
} from '@cashu/cashu-ts';
import { HARDENED_OFFSET } from '@scure/bip32';
import { decodeBolt11 } from '~/lib/bolt11';
import {
  CashuErrorCodes,
  type ExtendedCashuWallet,
  getCashuUnit,
  getOutputAmounts,
} from '~/lib/cashu';
import { Money } from '~/lib/money';
import type { CashuAccount } from '../accounts/account';
import {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  type CashuCryptography,
  useCashuCryptography,
} from '../shared/cashu';
import { derivePublicKey } from '../shared/cryptography';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import {
  type CashuReceiveQuoteRepository,
  useCashuReceiveQuoteRepository,
} from './cashu-receive-quote-repository';

export type CashuReceiveLightningQuote = {
  /**
   * The locked mint quote from the mint.
   */
  mintQuote: MintQuoteResponse;
  /**
   * The public key that locks the mint quote.
   */
  lockingPublicKey: string;
  /**
   * The full derivation path of the locking key. This is needed to derive the private key to unlock the mint quote.
   */
  fullLockingDerivationPath: string;
  /**
   * The expiration date of the mint quote.
   */
  expiresAt: string;
  /**
   * The amount to receive.
   */
  amount: Money;
  /**
   * The description of the receive request.
   */
  description?: string;
  /**
   * Optional fee that the mint charges to mint ecash. This amount is added to the payment request amount.
   */
  mintingFee?: Money;
  /**
   * The payment hash of the lightning invoice.
   */
  paymentHash: string;
};

export class CashuReceiveQuoteService {
  constructor(
    private readonly cryptography: CashuCryptography,
    private readonly cashuReceiveQuoteRepository: CashuReceiveQuoteRepository,
  ) {}

  /**
   * Gets a locked mint quote response for receiving lightning payments.
   * @returns The mint quote response and related data needed to create a receive quote.
   */
  async getLightningQuote({
    account,
    amount,
    description,
  }: {
    /**
     * The cashu account to which the money will be received.
     */
    account: CashuAccount;
    /**
     * The amount to receive.
     */
    amount: Money;
    /**
     * The description of the receive request.
     */
    description?: string;
  }): Promise<CashuReceiveLightningQuote> {
    const cashuUnit = getCashuUnit(amount.currency);

    const wallet = account.wallet;

    const { lockingPublicKey, fullLockingDerivationPath } =
      await this.deriveNut20LockingPublicKey();

    const mintQuoteResponse = await wallet.createLockedMintQuote(
      amount.toNumber(cashuUnit),
      lockingPublicKey,
      description,
    );

    const expiresAt = new Date(mintQuoteResponse.expiry * 1000).toISOString();

    const mintingFee = mintQuoteResponse.fee
      ? new Money({
          amount: mintQuoteResponse.fee,
          currency: amount.currency,
          unit: cashuUnit,
        })
      : undefined;

    const { paymentHash } = decodeBolt11(mintQuoteResponse.request);

    return {
      mintQuote: mintQuoteResponse,
      lockingPublicKey,
      fullLockingDerivationPath,
      expiresAt,
      amount,
      description,
      mintingFee,
      paymentHash,
    };
  }

  /**
   * Creates a new cashu receive quote used for receiving via a bolt11 payment request.
   * @returns The created cashu receive quote with the bolt11 invoice to pay.
   */
  async createReceiveQuote(
    params: {
      /**
       * The id of the user that will receive the money.
       */
      userId: string;
      /**
       * The cashu account to which the money will be received.
       */
      account: CashuAccount;
      /**
       * The lightning quote to create the cashu receive quote from.
       */
      lightningQuote: CashuReceiveLightningQuote;
      /**
       * Type of the receive.
       * - LIGHTNING - The money is received via a regular lightning payment.
       * - TOKEN - The money is received as a cashu token. The proofs will be melted
       *  from the account they originated from to pay the request for this receive quote.
       */
      receiveType: 'LIGHTNING' | 'TOKEN';
    } & (
      | {
          receiveType: 'LIGHTNING';
        }
      | {
          receiveType: 'TOKEN';
          /**
           * The amount of the token to receive.
           */
          tokenAmount: Money;
          /**
           * The fee (in the unit of the token) that will be incurred for spending the proofs as inputs to the melt operation.
           */
          cashuReceiveFee: Money;
          /**
           * The fee reserved for the lightning payment to melt the proofs to the account.
           */
          lightningFeeReserve: Money;
        }
    ),
  ): Promise<CashuReceiveQuote> {
    const {
      userId,
      account,
      lightningQuote: receiveQuote,
      receiveType,
    } = params;

    const baseReceiveQuote = {
      accountId: account.id,
      userId,
      amount: receiveQuote.amount,
      description: receiveQuote.description,
      quoteId: receiveQuote.mintQuote.quote,
      expiresAt: receiveQuote.expiresAt,
      state: receiveQuote.mintQuote.state as CashuReceiveQuote['state'],
      paymentRequest: receiveQuote.mintQuote.request,
      lockingDerivationPath: receiveQuote.fullLockingDerivationPath,
      mintingFee: receiveQuote.mintingFee,
    };

    if (receiveType === 'TOKEN') {
      const { tokenAmount, cashuReceiveFee, lightningFeeReserve } = params;

      return this.cashuReceiveQuoteRepository.create({
        ...baseReceiveQuote,
        receiveType,
        tokenAmount,
        cashuReceiveFee,
        lightningFeeReserve,
        paymentHash: receiveQuote.paymentHash,
      });
    }

    return this.cashuReceiveQuoteRepository.create({
      ...baseReceiveQuote,
      receiveType,
      paymentHash: receiveQuote.paymentHash,
    });
  }

  /**
   * Expires the cashu receive quote by setting the state to EXPIRED.
   * It's a no-op if the receive quote is already expired.
   * @param quote - The cashu receive quote to expire.
   * @throws An error if the receive quote is not unpaid or has not expired yet.
   */
  async expire(quote: CashuReceiveQuote): Promise<void> {
    if (quote.state === 'EXPIRED') {
      return;
    }

    if (quote.state !== 'UNPAID') {
      throw new Error('Cannot expire quote that is not unpaid');
    }

    if (new Date(quote.expiresAt) > new Date()) {
      throw new Error('Cannot expire quote that has not expired yet');
    }

    await this.cashuReceiveQuoteRepository.expire(quote.id);
  }

  /**
   * Completes the receive quote by preparing the output data, minting the proofs, updating the quote state and account proofs.
   * If the quote is already completed, it's a no-op that returns back passed quote, account and an empty array of added proof ids.
   * @param account - The cashu account that the quote belongs to.
   * @param quote - The cashu receive quote to complete.
   * @returns The updated quote, account and a list of added proof ids.
   * @throws An error if quote is expired or failed or if completing the quote fails.
   */
  async completeReceive(
    account: CashuAccount,
    quote: CashuReceiveQuote,
  ): Promise<{
    /**
     * The updated quote.
     */
    quote: CashuReceiveQuote;
    /**
     * The updated account with all the proofs including newly added ones.
     */
    account: CashuAccount;
    /**
     * A list of added proof ids.
     * Use if you need to know which proofs from the account proofs list are newly added.
     */
    addedProofs: string[];
  }> {
    if (quote.accountId !== account.id) {
      throw new Error('Quote does not belong to account');
    }

    if (quote.state === 'EXPIRED' || quote.state === 'FAILED') {
      throw new Error(
        `Cannot complete quote that is expired or failed. State: ${quote.state}`,
      );
    }

    if (quote.state === 'COMPLETED') {
      return { quote, account, addedProofs: [] };
    }

    const wallet = account.wallet;

    if (quote.state === 'UNPAID') {
      return await this.processUnpaidQuote(wallet, quote);
    }

    return await this.processPaidQuote(wallet, quote);
  }

  private async processUnpaidQuote(
    wallet: ExtendedCashuWallet,
    quote: CashuReceiveQuote,
  ): Promise<{
    quote: CashuReceiveQuote;
    account: CashuAccount;
    addedProofs: string[];
  }> {
    const keysetId = wallet.keysetId;
    const keys = await wallet.getKeys(keysetId);
    const cashuUnit = getCashuUnit(quote.amount.currency);
    const amountInCashuUnit = quote.amount.toNumber(cashuUnit);
    const outputAmounts = getOutputAmounts(amountInCashuUnit, keys);

    const result = await this.cashuReceiveQuoteRepository.processPayment({
      quote,
      keysetId,
      outputAmounts,
    });

    return this.processPaidQuote(wallet, result.quote);
  }

  private async processPaidQuote(
    wallet: ExtendedCashuWallet,
    quote: CashuReceiveQuote,
  ): Promise<{
    quote: CashuReceiveQuote;
    account: CashuAccount;
    addedProofs: string[];
  }> {
    if (quote.state !== 'PAID') {
      throw new Error('Quote must be in PAID state');
    }

    const cashuUnit = getCashuUnit(quote.amount.currency);
    const keys = await wallet.getKeys(quote.keysetId);

    const outputData = OutputData.createDeterministicData(
      quote.amount.toNumber(cashuUnit),
      wallet.seed,
      quote.keysetCounter,
      keys,
      quote.outputAmounts,
    );

    const mintedProofs = await this.mintProofs(wallet, quote, outputData);

    return await this.cashuReceiveQuoteRepository.completeReceive({
      quoteId: quote.id,
      proofs: mintedProofs,
    });
  }

  private async mintProofs(
    wallet: ExtendedCashuWallet,
    quote: CashuReceiveQuote,
    outputData: OutputData[],
  ): Promise<Proof[]> {
    if (quote.state !== 'PAID') {
      throw new Error(
        'Invalid quote state. Quote must be in PAID state to mint proofs.',
      );
    }

    try {
      const cashuUnit = getCashuUnit(quote.amount.currency);
      const amount = quote.amount.toNumber(cashuUnit);

      const unlockingKey = await this.cryptography.getPrivateKey(
        quote.lockingDerivationPath,
      );

      const proofs = await wallet.mintProofs(
        amount,
        // NOTE: cashu-ts makes us pass the mint quote response instead of just the quote id
        // if we want to use the private key to create a signature. However, the implementation
        // only ends up using the quote id.
        {
          quote: quote.quoteId,
          request: quote.paymentRequest,
          state: MintQuoteState.PAID,
          expiry: Math.floor(new Date(quote.expiresAt).getTime() / 1000),
          amount,
          unit: wallet.unit,
        },
        {
          keysetId: quote.keysetId,
          outputData,
          privateKey: unlockingKey,
        },
      );

      return proofs;
    } catch (error) {
      if (
        error instanceof MintOperationError &&
        ([
          CashuErrorCodes.OUTPUT_ALREADY_SIGNED,
          CashuErrorCodes.QUOTE_ALREADY_ISSUED,
        ].includes(error.code) ||
          // Nutshell mint implementation did not conform to the spec up until version 0.16.5 (see https://github.com/cashubtc/nutshell/pull/693)
          // so for earlier versions we need to check the message.
          error.message
            .toLowerCase()
            .includes('outputs have already been signed before') ||
          error.message.toLowerCase().includes('mint quote already issued.'))
      ) {
        const { proofs } = await wallet.restore(
          quote.keysetCounter,
          quote.outputAmounts.length,
          {
            keysetId: quote.keysetId,
          },
        );
        return proofs;
      }
      throw error;
    }
  }

  private async deriveNut20LockingPublicKey() {
    const xpub = await this.cryptography.getXpub(
      BASE_CASHU_LOCKING_DERIVATION_PATH,
    );

    const unhardenedIndex = Math.floor(
      Math.random() * (HARDENED_OFFSET - 1),
    ).toString();

    const lockingKey = derivePublicKey(xpub, `m/${unhardenedIndex}`);

    return {
      lockingPublicKey: lockingKey,
      fullLockingDerivationPath: `${BASE_CASHU_LOCKING_DERIVATION_PATH}/${unhardenedIndex}`,
    };
  }
}

export function useCashuReceiveQuoteService() {
  const cryptography = useCashuCryptography();
  const cashuReceiveQuoteRepository = useCashuReceiveQuoteRepository();
  return new CashuReceiveQuoteService(
    cryptography,
    cashuReceiveQuoteRepository,
  );
}
