import {
  CashuMint,
  CashuWallet,
  type Keys,
  type MintKeys,
  type MintKeyset,
  OutputData,
} from '@cashu/cashu-ts';
import Big from 'big.js';
import type { DistributedOmit } from 'type-fest';
import { decodeBolt11 } from '~/lib/bolt11';
import type { Currency, CurrencyUnit } from '../money';
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
 * ExtendedCashuWallet extends CashuWallet to allow custom postprocessing of proof selection.
 * We will remove this if cashu-ts ever updates selectProofsToSend not to return send proofs that are less than the amount.
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
