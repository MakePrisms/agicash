export type LNURLError = {
  status: 'ERROR';
  reason: string;
};

/**
 * Response from the lnurlp endpoint
 * @see https://github.com/lnurl/luds/blob/luds/06.md
 */
export type LNURLPayParams = {
  /**
   * The type of the LNURL
   */
  tag: 'payRequest';
  /**
   * The URL from LN SERVICE which will accept the pay request parameters
   * @example https://domain.com/api/lnurlp/callback/${user.id}
   */
  callback: string;
  /**
   * Max millisatoshi amount LN SERVICE is willing to receive
   */
  maxSendable: number;
  /**
   * Min millisatoshi amount LN SERVICE is willing to receive,
   * can not be less than 1 or more than `maxSendable`
   */
  minSendable: number;
  /**
   * Metadata json which must be presented as raw string here,
   * @example `[['text/plain', 'Pay to ${address}']]`
   */
  metadata: string;
};

/** Response from the lnurlp callback */
export type LNURLPayResult = {
  /**
   * bech-32 encoded bolt11 invoice
   */
  pr: string;
  /**
   * Optional URL to check the status of the invoice
   * @example https://domain.com/api/lnurlp/verify/${payment_id}
   */
  verify?: string;
  /**
   * Optional routes to the lightning node. Defaults to empty array
   */
  routes: string[];
};

/**
 * Response from the verify endpoint returned by the lnurlp callback
 * @see https://github.com/lnurl/luds/blob/luds/21.md
 */
export type LNURLVerifyResult = {
  status: 'OK';
  /**
   * True if the payment was settled, false otherwise
   */
  settled?: boolean;
  /**
   * Preimage of the payment
   */
  preimage: string | null;
  /**
   * bech-32 encoded bolt11 invoice
   */
  pr?: string;
};
