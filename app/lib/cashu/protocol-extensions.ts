/**
 * This file describes extensions to the Cashu protocol that are not included in the NUTs.
 * Currently, only the Agicash CDK fork implements these extensions for mints.
 *
 * Refer to the Agicash CDK fork to see changes that have been made on the mint side.
 * https://github.com/MakePrisms/cdk/blob/main/crates/cdk-agicash/README.md
 *
 * ## NUT-06 Agicash Extension
 *
 * Agicash mints extend the NUT-06 mint info response by including an `agicash` key,
 * which contains Agicash-specific configurations.
 *
 * Example:
 * {
 *   ...other fields,
 *   "agicash": {
 *     "deposit_fee": {
 *       "type": "basis_points",
 *       "value": 100
 *     }
 *   }
 * }
 *
 * ## Deposit Fees (extends NUT-23)
 *
 * Agicash mints can be configured to charge a fee for minting using the bolt11 payment method.
 * The `PostMintQuoteBolt11Response` has been extended to include a `fee` field that represents
 * the fee in the quote's unit (e.g., sats or usd).
 *
 * ### Fee Types
 *
 * Mints will advertise their deposit fee configuration in the NUT-06 mint info response under the
 * `agicash.deposit_fee` key.
 *
 * Currently, only `basis_points` is supported as a fee type. The NUT-06 config structure is:
 *
 * ```
 * {
 *   "deposit_fee": {
 *     "type": "basis_points",
 *     "value": <int> // Basis point value used to calculate the fee from the requested amount
 *   }
 * }
 * ```
 *
 * When the fee type is `basis_points`, the fee is calculated as:
 *
 * ```
 * fee = amount * (basis_points / 10000)
 * ```
 */

import type {
  LockedMintQuoteResponse,
  MintQuoteResponse,
  PartialMintQuoteResponse,
} from '@cashu/cashu-ts';

export type ExtendedMintQuoteResponse = MintQuoteResponse & {
  /**
   * Optional deposit fee charged by the mint for this quote, in the quote's unit.
   *
   * NOTE: This is not part of the NUT-23 spec, but is added by the Agicash CDK fork.
   */
  fee?: number;
};

export type ExtendedLockedMintQuoteResponse = LockedMintQuoteResponse & {
  /**
   * Optional deposit fee charged by the mint for this quote, in the quote's unit.
   *
   * NOTE: This is not part of the NUT-23 spec, but is added by the Agicash CDK fork.
   */
  fee?: number;
};

export type ExtendedPartialMintQuoteResponse = PartialMintQuoteResponse & {
  /**
   * Optional deposit fee charged by the mint for this quote, in the quote's unit.
   *
   * NOTE: This is not part of the NUT-23 spec, but is added by the Agicash CDK fork.
   */
  fee?: number;
};
