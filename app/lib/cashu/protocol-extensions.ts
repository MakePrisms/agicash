/**
 * TypeScript definitions for Cashu protocol extensions.
 * See PROTOCOL_EXTENSIONS.md for detailed documentation.
 */

import type {
  LockedMintQuoteResponse,
  MintQuoteResponse,
  PartialMintQuoteResponse,
} from '@cashu/cashu-ts';

/**
 * Extension type for mint quote responses that include a deposit fee.
 */
type MintQuoteFee = {
  /**
   * Optional deposit fee charged by the mint for this quote, in the quote's unit.
   *
   * NOTE: This is not part of the NUT-23 spec, but is added by the Agicash CDK fork.
   */
  fee?: number;
};

export type ExtendedMintQuoteResponse = MintQuoteResponse & MintQuoteFee;

export type ExtendedLockedMintQuoteResponse = LockedMintQuoteResponse &
  MintQuoteFee;

export type ExtendedPartialMintQuoteResponse = PartialMintQuoteResponse &
  MintQuoteFee;
