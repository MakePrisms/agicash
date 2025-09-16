/**
 * Based on https://github.com/cashubtc/nuts/blob/main/error_codes.md
 */
export enum CashuErrorCodes {
  /**
   * Blinded message of output already signed
   * Relevant nuts: @see [NUT-03](https://github.com/cashubtc/nuts/blob/main/03.md), [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md), [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  OUTPUT_ALREADY_SIGNED = 10002,

  /**
   * Token could not be verified
   * Relevant nuts: @see [NUT-03](https://github.com/cashubtc/nuts/blob/main/03.md), [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  TOKEN_VERIFICATION_FAILED = 10003,

  /**
   * Token is already spent
   * Relevant nuts: @see [NUT-03](https://github.com/cashubtc/nuts/blob/main/03.md), [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  TOKEN_ALREADY_SPENT = 11001,

  /**
   * Transaction is not balanced (inputs != outputs)
   * Relevant nuts: @see [NUT-02](https://github.com/cashubtc/nuts/blob/main/02.md), [NUT-03](https://github.com/cashubtc/nuts/blob/main/03.md), [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  TRANSACTION_NOT_BALANCED = 11002,

  /**
   * Unit in request is not supported
   * Relevant nuts: @see [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md), [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  UNIT_NOT_SUPPORTED = 11005,

  /**
   * Amount outside of limit range
   * Relevant nuts: @see [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md), [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  AMOUNT_OUT_OF_LIMITS = 11006,

  /**
   * Duplicate inputs provided
   * Relevant nuts: @see [NUT-03](https://github.com/cashubtc/nuts/blob/main/03.md), [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md), [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  DUPLICATE_INPUTS = 11007,

  /**
   * Duplicate outputs provided
   * Relevant nuts: @see [NUT-03](https://github.com/cashubtc/nuts/blob/main/03.md), [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md), [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  DUPLICATE_OUTPUTS = 11008,

  /**
   * Inputs/Outputs of multiple units
   * Relevant nuts: @see [NUT-03](https://github.com/cashubtc/nuts/blob/main/03.md), [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md), [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  MULTIPLE_UNITS = 11009,

  /**
   * Inputs and outputs not of same unit
   * Relevant nuts: @see [NUT-03](https://github.com/cashubtc/nuts/blob/main/03.md), [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md), [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  UNIT_MISMATCH = 11010,

  /**
   * Keyset is not known
   * Relevant nuts: @see [NUT-02](https://github.com/cashubtc/nuts/blob/main/02.md), [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md)
   */
  KEYSET_UNKNOWN = 12001,

  /**
   * Keyset is inactive, cannot sign messages
   * Relevant nuts: @see [NUT-02](https://github.com/cashubtc/nuts/blob/main/02.md), [NUT-03](https://github.com/cashubtc/nuts/blob/main/03.md), [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md)
   */
  KEYSET_INACTIVE = 12002,

  /**
   * Quote request is not paid
   * Relevant nuts: @see [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md)
   */
  QUOTE_NOT_PAID = 20001,

  /**
   * Tokens have already been issued for quote
   * Relevant nuts: @see [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md)
   */
  QUOTE_ALREADY_ISSUED = 20002,

  /**
   * Minting is disabled
   * Relevant nuts: @see [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md)
   */
  MINTING_DISABLED = 20003,

  /**
   * Lightning payment failed
   * Relevant nuts: @see [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  LIGHTNING_PAYMENT_FAILED = 20004,

  /**
   * Quote is pending
   * Relevant nuts: @see [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md), [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  QUOTE_PENDING = 20005,

  /**
   * Invoice already paid
   * Relevant nuts: @see [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  INVOICE_ALREADY_PAID = 20006,

  /**
   * Quote is expired
   * Relevant nuts: @see [NUT-04](https://github.com/cashubtc/nuts/blob/main/04.md), [NUT-05](https://github.com/cashubtc/nuts/blob/main/05.md)
   */
  QUOTE_EXPIRED = 20007,

  /**
   * Signature for mint request invalid
   * Relevant nuts: @see [NUT-20](https://github.com/cashubtc/nuts/blob/main/20.md)
   */
  INVALID_MINT_SIGNATURE = 20008,

  /**
   * Pubkey required for mint quote
   * Relevant nuts: @see [NUT-20](https://github.com/cashubtc/nuts/blob/main/20.md)
   */
  PUBKEY_REQUIRED = 20009,

  /**
   * Endpoint requires clear auth
   * Relevant nuts: @see [NUT-21](https://github.com/cashubtc/nuts/blob/main/21.md)
   */
  CLEAR_AUTH_REQUIRED = 30001,

  /**
   * Clear authentication failed
   * Relevant nuts: @see [NUT-21](https://github.com/cashubtc/nuts/blob/main/21.md)
   */
  CLEAR_AUTH_FAILED = 30002,

  /**
   * Endpoint requires blind auth
   * Relevant nuts: @see [NUT-22](https://github.com/cashubtc/nuts/blob/main/22.md)
   */
  BLIND_AUTH_REQUIRED = 31001,

  /**
   * Blind authentication failed
   * Relevant nuts: @see [NUT-22](https://github.com/cashubtc/nuts/blob/main/22.md)
   */
  BLIND_AUTH_FAILED = 31002,

  /**
   * Maximum BAT mint amount exceeded
   * Relevant nuts: @see [NUT-22](https://github.com/cashubtc/nuts/blob/main/22.md)
   */
  BAT_MINT_AMOUNT_EXCEEDED = 31003,

  /**
   * BAT mint rate limit exceeded
   * Relevant nuts: @see [NUT-22](https://github.com/cashubtc/nuts/blob/main/22.md)
   */
  BAT_MINT_RATE_LIMIT_EXCEEDED = 31004,

  /**
   * Witness is missing for p2pk signature
   * Relevant nuts: @see [NUT-11](https://github.com/cashubtc/nuts/blob/main/11.md)
   */
  WITNESS_MISSING_P2PK = 20008,
}

/**
 * Custom error message mappings to standard error codes.
 * These handle cases where different mint implementations return varying error messages
 * for the same underlying error condition.
 */
export const CashuErrorMessageMappings: Record<string, CashuErrorCodes> = {
  // Nutshell mint implementation did not conform to the spec up until version 0.16.5
  // https://github.com/cashubtc/nutshell/pull/693
  'outputs have already been signed before':
    CashuErrorCodes.OUTPUT_ALREADY_SIGNED,
  'Blinded Message is already signed': CashuErrorCodes.OUTPUT_ALREADY_SIGNED,
  'mint quote already issued.': CashuErrorCodes.QUOTE_ALREADY_ISSUED,
  'witness is missing for p2pk signature': CashuErrorCodes.WITNESS_MISSING_P2PK,
  'signature missing or invalid': CashuErrorCodes.WITNESS_MISSING_P2PK,
} as const;

/**
 * Checks if an error matches any of the specified error codes, either by direct code comparison
 * or by matching known error message patterns.
 *
 * @param error The error to check (should be a MintOperationError)
 * @param codes Array of CashuErrorCodes to match against
 * @returns true if the error matches any of the specified codes
 */
export function isCashuError(
  error: { code?: number; message?: string },
  codes: CashuErrorCodes[],
): boolean {
  if (error.code && codes.includes(error.code)) {
    return true;
  }

  if (error.message) {
    const normalizedMessage = error.message.toLowerCase();

    for (const [pattern, errorCode] of Object.entries(
      CashuErrorMessageMappings,
    )) {
      if (
        normalizedMessage.includes(pattern.toLowerCase()) &&
        codes.includes(errorCode)
      ) {
        return true;
      }
    }
  }

  return false;
}
