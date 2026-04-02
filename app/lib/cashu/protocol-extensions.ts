/**
 * TypeScript definitions for Cashu protocol extensions.
 * See PROTOCOL_EXTENSIONS.md for detailed documentation.
 */

import {
  type GetInfoResponse,
  MintInfo,
  type MintQuoteBolt11Response,
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

/**
 * The purpose of a Cashu mint as advertised in its info response.
 * - 'transactional': Regular mint for sending/receiving payments
 * - 'gift-card': Closed-loop mint issuing gift cards
 * - 'offer': Promotional ecash with an expiry
 */
export type MintPurpose = 'transactional' | 'gift-card' | 'offer';

/**
 * Agicash-specific mint info extension.
 * This is included in the mint's info response under the "agicash" key.
 */
export type AgicashMintExtension = {
  purpose?: MintPurpose;
};

/**
 * Extended GetInfoResponse that includes agicash-specific extensions.
 * This is the raw response from the mint's info endpoint with agicash extensions.
 */
type ExtendedGetInfoResponse = GetInfoResponse & {
  agicash?: AgicashMintExtension;
};

/**
 * Extended MintInfo that includes agicash-specific extensions.
 * Extends the v3 MintInfo class to provide typed access to agicash
 * extensions from the raw mint info response.
 */
export class ExtendedMintInfo extends MintInfo {
  get agicash(): AgicashMintExtension | undefined {
    return (this.cache as ExtendedGetInfoResponse).agicash;
  }
}

export type ExtendedMintQuoteBolt11Response = MintQuoteBolt11Response &
  MintQuoteFee;
