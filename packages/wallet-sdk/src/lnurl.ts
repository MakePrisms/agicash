import type { Money } from '@agicash/utils/money';
import ky from 'ky';
import { buildLightningAddressFormatValidator } from './lightning-address';
import type { LNURLError, LNURLPayParams, LNURLPayResult } from './lnurl-types';

export { buildLightningAddressFormatValidator };

export const isLNURLError = (obj: unknown): obj is LNURLError => {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'status' in obj &&
    obj.status === 'ERROR'
  );
};

export const getLNURLPayParams = async (
  lightningAddress: string,
): Promise<LNURLPayParams | LNURLError> => {
  const [username, domain] = lightningAddress.split('@');
  if (!username || !domain) {
    return { status: 'ERROR', reason: 'Invalid lightning address' };
  }
  const protocol =
    domain.startsWith('localhost') || domain.startsWith('127.0.0.1')
      ? 'http'
      : 'https';
  return ky
    .get(`${protocol}://${domain}/.well-known/lnurlp/${username}`)
    .json();
};

/**
 * Fetch an invoice from a lightning address
 * @param lightningAddress - Lightning address to get the invoice from
 * @param amountMsat - Amount in msat to request
 * @param requestDomain - Optional domain of the requester, used to decide if we should include `bypassAmountValidation=true` in the callback URL.
 * This signals to the LNURL server that we will not validate that the invoice amount matches the requested amount.
 * If requests are Agicash to Agicash, then the Agicash LNURL server will receive to the user's default currency which may result in exchange rate differences.
 * @see[LUD 16](https://github.com/lnurl/luds/blob/luds/16.md)
 * @example
 * ```ts
 * // request 10 sats from alice@example.com
 * const {pr: invoice} = await getInvoiceFromLightningAddress('alice@example.com', 10_000);
 * ```
 */
export const getInvoiceFromLud16 = async (
  lud16: string,
  amount: Money<'BTC'>,
  requestDomain?: string,
): Promise<LNURLPayResult | LNURLError> => {
  const amountMsat = amount.toNumber('msat');

  try {
    const params = await getLNURLPayParams(lud16);

    if (isLNURLError(params)) return params;

    const { callback, minSendable, maxSendable } = params;

    if (amountMsat < minSendable || amountMsat > maxSendable) {
      return {
        status: 'ERROR',
        reason: `Amount must be between ${minSendable} and ${maxSendable} msat`,
      };
    }

    const [, lnurlDomain] = lud16.split('@');
    const shouldBypassValidation = lnurlDomain === requestDomain;

    const callbackUrl = new URL(callback);
    callbackUrl.searchParams.set('amount', amountMsat.toString());
    if (shouldBypassValidation) {
      callbackUrl.searchParams.set('bypassAmountValidation', 'true');
    }

    const callbackRes = await ky
      .get(callbackUrl)
      .json<LNURLPayResult | LNURLError>();

    if (isLNURLError(callbackRes)) return callbackRes;

    return {
      pr: callbackRes.pr,
      verify: callbackRes.verify,
      routes: callbackRes.routes ?? [],
    };
  } catch (error) {
    const message = 'Failed to get invoice';
    console.error(message, { cause: error });
    return {
      status: 'ERROR',
      reason: error instanceof Error ? error.message : message,
    };
  }
};

export const isValidLightningAddress = async (address: string) => {
  try {
    const params = await getLNURLPayParams(address);
    return !isLNURLError(params);
  } catch {
    return false;
  }
};

export const buildLightningAddressValidator = (props: {
  message: string;
  allowLocalhost?: boolean;
}) => {
  const validateLightningAddressFormat =
    buildLightningAddressFormatValidator(props);

  return async (
    value: string | null | undefined,
  ): Promise<string | boolean> => {
    const isValidFormat = validateLightningAddressFormat(value);

    if (isValidFormat !== true || !value) {
      return isValidFormat;
    }

    const isAddressValid = await isValidLightningAddress(value);

    return !isAddressValid ? props.message : true;
  };
};

export type { LNURLPayResult, LNURLError };
