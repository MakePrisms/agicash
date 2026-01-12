import type { MintQuoteResponse, Proof } from '@cashu/cashu-ts';
import { HARDENED_OFFSET } from '@scure/bip32';
import { decodeBolt11 } from '~/lib/bolt11';
import { type ExtendedCashuWallet, getCashuUnit } from '~/lib/cashu';
import { Money } from '~/lib/money';
import type { RedactedCashuAccount } from '../accounts/account';
import { BASE_CASHU_LOCKING_DERIVATION_PATH } from '../shared/cashu';
import { derivePublicKey } from '../shared/cryptography';
import type { CashuReceiveQuote } from './cashu-receive-quote';

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

export type GetLightningQuoteParams = {
  /**
   * The cashu wallet to use to get a quote.
   */
  wallet: ExtendedCashuWallet;
  /**
   * The amount to receive.
   */
  amount: Money;
  /**
   * The description of the receive request.
   */
  description?: string;
  /**
   * Receiver's cashu locking xPub.
   */
  xPub: string;
};

export type CreateQuoteBaseParams = {
  /**
   * The id of the user that will receive the money.
   */
  userId: string;
  /**
   * The cashu account to which the money will be received.
   */
  account: RedactedCashuAccount;
  /**
   * The lightning quote to create the cashu receive quote from.
   */
  lightningQuote: CashuReceiveLightningQuote;
  /**
   * Type of the receive.
   * - LIGHTNING - The money is received via a regular lightning payment.
   * - CASHU_TOKEN - The money is received as a cashu token. The proofs will be melted
   *   from the account they originated from to pay the request for this receive quote.
   */
  receiveType: 'LIGHTNING' | 'CASHU_TOKEN';
} & (
  | {
      receiveType: 'LIGHTNING';
    }
  | {
      receiveType: 'CASHU_TOKEN';
      /**
       * The amount of the token to receive.
       */
      tokenAmount: Money;
      /**
       * URL of the source mint where the token proofs originate from.
       */
      sourceMintUrl: string;
      /**
       * The proofs from the source cashu token that will be melted.
       */
      tokenProofs: Proof[];
      /**
       * ID of the melt quote on the source mint.
       */
      meltQuoteId: string;
      /**
       * The expiry of the melt quote in ISO 8601 format.
       */
      meltQuoteExpiresAt: string;
      /**
       * The fee (in the unit of the token) that will be incurred for spending the proofs as inputs to the melt operation.
       */
      cashuReceiveFee: Money;
      /**
       * The fee reserved for the lightning payment to melt the proofs to the account.
       */
      lightningFeeReserve: Money;
    }
);

/**
 * Parameters for creating a receive quote in the repository.
 */
export type RepositoryCreateQuoteParams = {
  /**
   * ID of the receiving user.
   */
  userId: string;
  /**
   * ID of the receiving account.
   */
  accountId: string;
  /**
   * Amount of the quote.
   */
  amount: Money;
  /**
   * ID of the mint's quote. Used after the payment to exchange the quote for proofs.
   */
  quoteId: string;
  /**
   * Lightning payment request.
   */
  paymentRequest: string;
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
  /**
   * Expiry of the quote in ISO 8601 format.
   */
  expiresAt: string;
  /**
   * Description of the quote.
   */
  description?: string;
  /**
   * The full BIP32 derivation path used to derive the public key for locking the cashu mint quote.
   */
  lockingDerivationPath: string;
  /**
   * Type of the receive.
   * - LIGHTNING - The money is received via Lightning.
   * - CASHU_TOKEN - The money is received as a cashu token. The proofs will be melted
   *   from the account they originated from to pay the request for this receive quote.
   */
  receiveType: CashuReceiveQuote['type'];
  /**
   * Optional fee that the mint charges to mint ecash. This amount is added to the payment request amount.
   */
  mintingFee?: Money;
  /**
   * Total fee for the receive.
   */
  totalFee: Money;
} & (
  | {
      receiveType: 'LIGHTNING';
    }
  | {
      receiveType: 'CASHU_TOKEN';
      /**
       * The data for the melt operation.
       */
      meltData: {
        /**
         * URL of the source mint where the token proofs originate from.
         */
        tokenMintUrl: string;
        /**
         * ID of the melt quote on the source mint.
         */
        meltQuoteId: string;
        /**
         * The amount of the token to receive.
         */
        tokenAmount: Money;
        /**
         * The proofs from the source cashu token that will be melted.
         */
        tokenProofs: Proof[];
        /**
         * The fee that is paid for spending the token proofs as inputs to the melt operation.
         */
        cashuReceiveFee: Money;
        /**
         * The fee reserved for the lightning payment to melt the token proofs to this account.
         */
        lightningFeeReserve: Money;
      };
    }
);

/**
 * Derives a NUT-20 locking public key for Cashu mint quotes.
 * @returns The locking public key and full derivation path.
 */
export async function deriveNut20LockingPublicKey(xPub: string): Promise<{
  lockingPublicKey: string;
  fullLockingDerivationPath: string;
}> {
  const unhardenedIndex = Math.floor(
    Math.random() * (HARDENED_OFFSET - 1),
  ).toString();

  const lockingKey = derivePublicKey(xPub, `m/${unhardenedIndex}`);

  return {
    lockingPublicKey: lockingKey,
    fullLockingDerivationPath: `${BASE_CASHU_LOCKING_DERIVATION_PATH}/${unhardenedIndex}`,
  };
}

/**
 * Gets a locked mint quote response for receiving lightning payments.
 * @returns The mint quote response and related data needed to create a receive quote.
 */
export async function getLightningQuote(
  params: GetLightningQuoteParams,
): Promise<CashuReceiveLightningQuote> {
  const { wallet, amount, description, xPub } = params;

  const cashuUnit = getCashuUnit(amount.currency);

  const { lockingPublicKey, fullLockingDerivationPath } =
    await deriveNut20LockingPublicKey(xPub);

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
 * Computes the expiry date for a receive quote.
 * For LIGHTNING type quotes, the expiry is the mint quote expiry.
 * For CASHU_TOKEN type quotes, the expiry is the earler of the mint quote expiry and the melt quote expiry.
 */
export function computeQuoteExpiry(params: CreateQuoteBaseParams): string {
  if (params.receiveType === 'LIGHTNING') {
    return params.lightningQuote.expiresAt;
  }

  return new Date(
    Math.min(
      new Date(params.lightningQuote.expiresAt).getTime(),
      new Date(params.meltQuoteExpiresAt).getTime(),
    ),
  ).toISOString();
}

/**
 * Computes the total fee for a receive quote.
 * @param params - The parameters for the receive quote.
 * @returns The total fee for the receive quote.
 */
export function computeTotalFee(params: CreateQuoteBaseParams): Money {
  const mintingFee =
    params.lightningQuote.mintingFee ??
    Money.zero(params.lightningQuote.amount.currency);

  if (params.receiveType === 'LIGHTNING') {
    return mintingFee;
  }

  return mintingFee.add(params.cashuReceiveFee).add(params.lightningFeeReserve);
}
