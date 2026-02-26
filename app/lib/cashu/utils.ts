import {
  CashuMint,
  CashuWallet,
  type Keys,
  type MeltQuoteResponse,
  MeltQuoteState,
  type MintKeys,
  type MintKeyset,
  type MintQuoteResponse,
  OutputData,
  type Proof,
} from '@cashu/cashu-ts';
import Big from 'big.js';
import type { DistributedOmit } from 'type-fest';
import { decodeBolt11 } from '~/lib/bolt11';
import type { Currency, CurrencyUnit } from '../money';
import type {
  ExtendedGetInfoResponse,
  ExtendedLockedMintQuoteResponse,
  ExtendedMintInfo,
  ExtendedMintQuoteResponse,
  ExtendedPartialMintQuoteResponse,
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
 *
 * Accepts either a raw GetInfoResponse or the MintInfo class wrapper.
 * The MintInfo class hides the raw response in a private `_mintInfo` field,
 * so we unwrap it to access custom extension fields like `agicash`.
 *
 * TODO: We can remove this when we upgrade to cashu-ts v3 and then we can have better control of the MintInfo class.
 */
export const getMintPurpose = (
  mintInfo: ExtendedMintInfo | null | undefined,
): 'gift-card' | 'transactional' => {
  // The MintInfo class may be double-wrapped (mintInfoQueryOptions returns a
  // MintInfo class, and the CashuWallet constructor wraps it again). Unwrap
  // all layers to reach the raw GetInfoResponse.
  let raw: unknown = mintInfo;
  while (raw != null && typeof raw === 'object' && '_mintInfo' in raw) {
    raw = (raw as { _mintInfo: unknown })._mintInfo;
  }
  return (raw as ExtendedGetInfoResponse | undefined)?.agicash?.closed_loop
    ? 'gift-card'
    : 'transactional';
};

export const getWalletCurrency = (wallet: CashuWallet) => {
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
export class ExtendedCashuWallet extends CashuWallet {
  private _bip39Seed: Uint8Array | undefined;

  constructor(
    mint: CashuMint,
    options: ConstructorParameters<typeof CashuWallet>[1],
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
   * This overrides the base class mintInfo getter to return the extended type.
   */
  override get mintInfo(): ExtendedMintInfo {
    return super.mintInfo as ExtendedMintInfo;
  }

  /**
   * Gets the purpose of this mint based on its configuration.
   */
  get purpose(): 'gift-card' | 'transactional' {
    return getMintPurpose(this.mintInfo);
  }

  /**
   * This method overrides the createMintQuote method from CashuWallet to return ExtendedMintQuoteResponse
   */
  async createMintQuote(
    amount: Parameters<CashuWallet['createMintQuote']>[0],
    description?: Parameters<CashuWallet['createMintQuote']>[1],
  ): Promise<ExtendedMintQuoteResponse> {
    return super.createMintQuote(
      amount,
      description,
    ) as Promise<ExtendedMintQuoteResponse>;
  }

  /**
   * This method overrides the createLockedMintQuote method from CashuWallet to return ExtendedLockedMintQuoteResponse
   */
  async createLockedMintQuote(
    amount: Parameters<CashuWallet['createLockedMintQuote']>[0],
    pubkey: Parameters<CashuWallet['createLockedMintQuote']>[1],
    description?: Parameters<CashuWallet['createLockedMintQuote']>[2],
  ): Promise<ExtendedLockedMintQuoteResponse> {
    return super.createLockedMintQuote(
      amount,
      pubkey,
      description,
    ) as Promise<ExtendedLockedMintQuoteResponse>;
  }

  /**
   * This method overrides the checkMintQuote method from CashuWallet to return ExtendedMintQuoteResponse
   */
  checkMintQuote(quote: MintQuoteResponse): Promise<ExtendedMintQuoteResponse>;
  checkMintQuote(quote: string): Promise<ExtendedPartialMintQuoteResponse>;
  async checkMintQuote(
    quote: MintQuoteResponse | string,
  ): Promise<ExtendedMintQuoteResponse | ExtendedPartialMintQuoteResponse> {
    if (typeof quote === 'string') {
      return super.checkMintQuote(
        quote,
      ) as Promise<ExtendedPartialMintQuoteResponse>;
    }
    return super.checkMintQuote(quote) as Promise<ExtendedMintQuoteResponse>;
  }

  /**
   * Get the estimated fee to receive at least the given amount.
   * If cashu token has value of amount plus the fee returned by this function, the receiver can swap it for at least that amount.
   * @param amount - The minimum amount to receive
   * @returns The estimated fee
   */
  getFeesEstimateToReceiveAtLeast(amount: number | Big) {
    const amountBig = new Big(amount);
    const keyset = this.getActiveKeyset(this.keysets);

    if (!keyset?.input_fee_ppk) {
      return 0;
    }

    const { keys = null } = this.keys.get(keyset.id) ?? {};
    if (!keys) {
      throw new Error('Keys not found');
    }

    const minNumberOfProofs = this.getMinNumberOfProofsForAmount(
      keys,
      amountBig,
    );
    const fee = this.getFeeForNumberOfProofs(
      minNumberOfProofs,
      keyset.input_fee_ppk,
    );

    return fee;
  }

  /**
   * Melts proofs with idempotent error handling.
   * If meltProofs fails but the quote is already pending/paid, returns success.
   * This handles the case where meltProofs is called twice for the same quote.
   */
  async meltProofsIdempotent(
    meltQuote: Pick<MeltQuoteResponse, 'quote' | 'amount'>,
    proofs: Proof[],
    options?: Parameters<CashuWallet['meltProofs']>[2],
  ) {
    // meltProofs method doesn't use anything but quote and amount so we can pass a dummy MeltQuoteResponse
    return this.meltProofs(
      meltQuote as MeltQuoteResponse,
      proofs,
      options,
    ).catch(async (error) => {
      // Melt should be idempotent: if meltProofs was already called once and did not fail,
      // then the melt quote will be pending or paid.
      const latestMeltQuote = await this.checkMeltQuote(meltQuote.quote);
      if (latestMeltQuote.state !== MeltQuoteState.UNPAID) {
        console.debug('meltProofs was called but melt quote is not unpaid');
        return latestMeltQuote;
      }
      throw error;
    });
  }

  private getMinNumberOfProofsForAmount(keys: Keys, amount: Big) {
    const availableDenominations = Object.keys(keys).map((x) => new Big(x));
    const biggestDenomination = availableDenominations.reduce(
      (max, curr) => (curr.gt(max) ? curr : max),
      new Big(0),
    );

    return this.getInPowersOfTwo(new Big(amount), biggestDenomination).length;
  }

  /**
   * Get the powers of two that sum up to the given number
   * @param n - The number to get the powers of two for
   * @param maxValue - The maximum power of two value that can be used
   * @returns The powers of two that sum up to the given number
   */
  private getInPowersOfTwo(number: Big, maxValue: Big): Big[] {
    const result: Big[] = [];
    let n = number;

    for (let pow = maxValue; pow.gte(1); pow = pow.div(2).round(0, 0)) {
      const count = n.div(pow).round(0, 0); // floor division
      if (count.gt(0)) {
        for (let i = 0; i < count.toNumber(); i++) {
          result.push(pow);
        }
        n = n.minus(count.times(pow));
      }
      if (n.eq(0)) break;
    }

    if (n.gt(0))
      throw new Error('Cannot represent number with given max value');

    return result;
  }

  private getFeeForNumberOfProofs(numberOfProofs: number, inputFeePpk: number) {
    return Math.floor((numberOfProofs * inputFeePpk + 999) / 1000);
  }
}

export const getCashuWallet = (
  mintUrl: string,
  options: DistributedOmit<
    ConstructorParameters<typeof CashuWallet>[1],
    'unit'
  > & {
    unit?: CurrencyUnit;
  } = {},
) => {
  const { unit, ...rest } = options;
  // Cashu calls the unit 'usd' even though the amount is in cents.
  // To avoid this confusion we use 'cent' everywhere and then here we switch the value to 'usd' before creating the Cashu wallet.
  const cashuUnit = options.unit === 'cent' ? 'usd' : options.unit;
  return new ExtendedCashuWallet(new CashuMint(mintUrl), {
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
  const { request: bolt11 } = await wallet.createMintQuote(1);
  const { network } = decodeBolt11(bolt11);
  return network !== 'bitcoin';
};

export const getKeysets = async (
  mintUrl: string,
  unit: CurrencyUnit,
): Promise<Array<MintKeyset>> => {
  return getCashuWallet(mintUrl, { unit }).getKeySets();
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

/**
 * Calculates the output amounts needed for a given amount using the provided mint keys.
 * @param amount - The amount to get the output amounts for
 * @param keys - The mint keys to use for the output data
 * @returns The output amounts that sum to the given amount
 */
export const getOutputAmounts = (amount: number, keys: MintKeys): number[] => {
  return OutputData.createDeterministicData(
    amount,
    // Wallet seed and keyset counter don't matter for getting the output amounts which sum to the provided amount so we are just using dummy values.
    // We need to do this because splitAmount function used by createDeterministicData is not exposed by cashu-ts (see https://github.com/cashubtc/cashu-ts/blob/v2.6.0/src/model/OutputData.ts#L158)
    // Using 32 bytes (256 bits) dummy seed to satisfy HDKey requirements
    new Uint8Array(32),
    0,
    keys,
  ).map((output) => output.blindedMessage.amount);
};
