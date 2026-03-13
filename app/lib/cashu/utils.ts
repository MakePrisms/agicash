import {
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  type Mint,
  type MintQuoteBolt11Response,
  type Proof,
  Wallet,
  splitAmount,
} from '@cashu/cashu-ts';
import type { DistributedOmit } from 'type-fest';
import { decodeBolt11 } from '~/lib/bolt11';
import type { Currency, CurrencyUnit } from '../money';
import {
  type ExtendedLockedMintQuoteResponse,
  ExtendedMintInfo,
  type ExtendedMintQuoteResponse,
} from './protocol-extensions';
import type { CashuProtocolUnit } from './types';

const knownTestMints = [
  'https://testnut.cashu.space',
  'https://nofees.testnut.cashu.space',
];

const currencyToUnit: {
  [K in Currency]: CurrencyUnit<K>;
} = {
  BTC: 'sat',
  USD: 'cent',
};

const currencyToCashuProtocolUnit: {
  [K in Currency]: CashuProtocolUnit;
} = {
  BTC: 'sat',
  USD: 'usd',
};

const cashuProtocolUnitToCurrency: {
  [key in CashuProtocolUnit]: Currency;
} = {
  sat: 'BTC',
  usd: 'USD',
};

/**
 * Gets the unit that should be used when dealing with amounts from Cashu in the rest of the application.
 * Cashu uses 'usd' to represent cent values which is confusing, so we map it to 'cent'.
 *
 * See `getCashuProtocolUnit` for getting the unit to use when interfacing with the Cashu protocol.
 *
 * @param currency - The currency to get the unit for
 * @returns The unit ('sat' for BTC, 'cent' for USD)
 */
export const getCashuUnit = (currency: Currency) => {
  return currencyToUnit[currency];
};

/**
 * Gets the unit that the Cashu protocol expects for a given currency.
 * These units are not defined in Cashu, but there is a convention that
 * the amounts are in the smallest unit of the specified currency.
 *
 * For example, the cashu protocol unit for USD is 'usd' and represents amounts in cents.
 *
 * See `getCashuUnit` for getting the unit to use when dealing with amounts from Cashu in the rest of the application.
 *
 * @param currency - The currency to get the protocol unit for
 * @returns The Cashu protocol unit ('sat' for BTC, 'usd' for USD amounts in cents)
 */
export const getCashuProtocolUnit = (currency: Currency) => {
  return currencyToCashuProtocolUnit[currency];
};

/**
 * Determines the purpose of a mint based on its info.
 */
export const getMintPurpose = (
  mintInfo: ExtendedMintInfo | null | undefined,
): 'gift-card' | 'transactional' => {
  return mintInfo?.agicash?.closed_loop ? 'gift-card' : 'transactional';
};

export const getWalletCurrency = (wallet: Wallet) => {
  const unit = wallet.unit as keyof typeof cashuProtocolUnitToCurrency;
  if (!cashuProtocolUnitToCurrency[unit]) {
    throw new Error(`Unsupported cashu wallet unit: ${unit}`);
  }
  return cashuProtocolUnitToCurrency[unit];
};

// TODO: see if we can use this extended wallet class to completely abstract away the mismtach between cashu protocol unit and the units we use (cashu protocol unit is 'usd' for cents, but we use 'cent' for cents)
// If we do that maybe we can even get rid of this getCashuWallet function
/**
 * ExtendedCashuWallet extends CashuWallet with functionality required by agicash.
 *
 * Provides:
 * - Overridden mint quote methods that return extended response types as defined in [protocol-extensions.ts](./protocol-extensions.ts)
 * - Direct access to the bip39 seed
 * - Fee estimation utilities for receiving operations
 * - Access to agicash-specific mint extensions (e.g., closed loop mode)
 */
export class ExtendedCashuWallet extends Wallet {
  private _bip39Seed: Uint8Array | undefined;

  constructor(
    mint: Mint | string,
    options: ConstructorParameters<typeof Wallet>[1],
  ) {
    super(mint, options);
    this._bip39Seed = options?.bip39seed;
  }

  get seed() {
    if (!this._bip39Seed) {
      throw new Error('Seed not set');
    }
    return this._bip39Seed;
  }

  /**
   * Returns the mint info with agicash-specific extensions.
   */
  override getMintInfo(): ExtendedMintInfo {
    return new ExtendedMintInfo(super.getMintInfo().cache);
  }

  /**
   * Gets the purpose of this mint based on its configuration.
   */
  get purpose(): 'gift-card' | 'transactional' {
    return getMintPurpose(this.getMintInfo());
  }

  /**
   * This method overrides the createMintQuoteBolt11 method from Wallet to return ExtendedMintQuoteResponse
   */
  override async createMintQuoteBolt11(
    amount: Parameters<Wallet['createMintQuoteBolt11']>[0],
    description?: Parameters<Wallet['createMintQuoteBolt11']>[1],
  ): Promise<ExtendedMintQuoteResponse> {
    return super.createMintQuoteBolt11(
      amount,
      description,
    ) as Promise<ExtendedMintQuoteResponse>;
  }

  /**
   * This method overrides the createLockedMintQuote method from CashuWallet to return ExtendedLockedMintQuoteResponse
   */
  async createLockedMintQuote(
    amount: Parameters<Wallet['createLockedMintQuote']>[0],
    pubkey: Parameters<Wallet['createLockedMintQuote']>[1],
    description?: Parameters<Wallet['createLockedMintQuote']>[2],
  ): Promise<ExtendedLockedMintQuoteResponse> {
    return super.createLockedMintQuote(
      amount,
      pubkey,
      description,
    ) as Promise<ExtendedLockedMintQuoteResponse>;
  }

  /**
   * This method overrides the checkMintQuoteBolt11 method from Wallet to return ExtendedMintQuoteResponse
   */
  override async checkMintQuoteBolt11(
    quote: MintQuoteBolt11Response | string,
  ): Promise<ExtendedMintQuoteResponse> {
    return super.checkMintQuoteBolt11(
      quote,
    ) as Promise<ExtendedMintQuoteResponse>;
  }

  /**
   * Get the estimated fee to receive at least the given amount.
   * If cashu token has value of amount plus the fee returned by this function, the receiver can swap it for at least that amount.
   * @param amount - The minimum amount to receive
   * @returns The estimated fee
   */
  getFeesEstimateToReceiveAtLeast(amount: number) {
    const keyset = this.keyChain.getCheapestKeyset();

    if (!keyset?.fee) {
      return 0;
    }

    const minNumberOfProofs = splitAmount(amount, keyset.keys).length;
    const fee = this.getFeeForNumberOfProofs(minNumberOfProofs, keyset.fee);

    return fee;
  }

  /**
   * Melts proofs with idempotent error handling.
   * If meltProofs fails but the quote is already pending/paid, returns success.
   * This handles the case where meltProofs is called twice for the same quote.
   */
  async meltProofsIdempotent(
    meltQuote: Pick<MeltQuoteBolt11Response, 'quote' | 'amount'>,
    proofs: Proof[],
    config?: Parameters<Wallet['meltProofsBolt11']>[2],
    outputType?: Parameters<Wallet['meltProofsBolt11']>[3],
  ) {
    // meltProofsBolt11 method doesn't use anything but quote and amount so we can pass a dummy MeltQuoteBolt11Response
    return this.meltProofsBolt11(
      meltQuote as MeltQuoteBolt11Response,
      proofs,
      config,
      outputType,
    ).catch(async (error) => {
      // Melt should be idempotent: if meltProofsBolt11 was already called once and did not fail,
      // then the melt quote will be pending or paid.
      const latestMeltQuote = await this.checkMeltQuoteBolt11(meltQuote.quote);
      if (latestMeltQuote.state !== MeltQuoteState.UNPAID) {
        console.debug(
          'meltProofsBolt11 was called but melt quote is not unpaid',
        );
        return latestMeltQuote;
      }
      throw error;
    });
  }

  private getFeeForNumberOfProofs(numberOfProofs: number, inputFeePpk: number) {
    return Math.floor((numberOfProofs * inputFeePpk + 999) / 1000);
  }
}

export const getCashuWallet = (
  mintUrl: string,
  options: DistributedOmit<ConstructorParameters<typeof Wallet>[1], 'unit'> & {
    unit?: CurrencyUnit;
  } = {},
) => {
  const { unit, ...rest } = options;
  // Cashu calls the unit 'usd' even though the amount is in cents.
  // To avoid this confusion we use 'cent' everywhere and then here we switch the value to 'usd' before creating the Cashu wallet.
  const cashuUnit = options.unit === 'cent' ? 'usd' : options.unit;
  return new ExtendedCashuWallet(mintUrl, {
    ...rest,
    unit: cashuUnit,
  });
};

/**
 * Check if a mint is a test mint by checking the network of the mint quote
 * and also checking if the mint is in the list of known test mints
 *
 * Known test mints:
 * - https://testnut.cashu.space
 * - https://nofees.testnut.cashu.space
 *
 * @param mintUrl - The URL of the mint
 * @returns True if the mint is not on mainnet
 */
export const checkIsTestMint = async (mintUrl: string): Promise<boolean> => {
  // Normalize URL by removing trailing slash and converting to lowercase
  const normalizedUrl = mintUrl.toLowerCase().replace(/\/+$/, '');
  if (knownTestMints.includes(normalizedUrl)) {
    return true;
  }
  const wallet = getCashuWallet(mintUrl);
  const { request: bolt11 } = await wallet.createMintQuoteBolt11(1);
  const { network } = decodeBolt11(bolt11);
  return network !== 'bitcoin';
};

/**
 * Check if two mint URLs are equal by normalizing them then comparing them.
 * @param a - The first mint URL
 * @param b - The second mint URL
 * @returns True if the mint URLs are equal
 */
export const areMintUrlsEqual = (a: string, b: string) => {
  return (
    a.toLowerCase().replace(/\/+$/, '').trim() ===
    b.toLowerCase().replace(/\/+$/, '').trim()
  );
};
