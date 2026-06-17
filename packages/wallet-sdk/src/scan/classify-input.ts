import { extractCashuToken } from '@agicash/cashu/token';
import { type DecodedBolt11, parseBolt11Invoice } from '@agicash/utils/bolt11';
import { buildLightningAddressFormatValidator } from '../lightning-address';

export type ClassifiedInput =
  | { direction: 'receive'; type: 'cashu-token'; encoded: string }
  | {
      direction: 'send';
      type: 'bolt11';
      invoice: string;
      decoded: DecodedBolt11;
    }
  | { direction: 'send'; type: 'ln-address'; address: string };

export type SendInput = Extract<ClassifiedInput, { direction: 'send' }>;
export type ReceiveInput = Extract<ClassifiedInput, { direction: 'receive' }>;

export type ClassifyInputOptions = {
  /**
   * Accept `name@localhost[:port]` lightning addresses (local development).
   * Hosts derive this from their environment (the web passes
   * `import.meta.env.DEV`). Defaults to false.
   */
  allowLocalhost?: boolean;
};

/**
 * Classifies a raw scanned/pasted/typed string into a wallet action: a cashu
 * token to receive, or a bolt11 invoice / lightning address to send. Pure: no
 * network lookup, no state. Returns null when the input matches nothing.
 *
 * A cashu token is detected first (it can be wrapped in a URL or `cashu:` URI),
 * then a bolt11 invoice, then a LUD-16 lightning-address format.
 */
export function classifyInput(
  raw: string,
  options: ClassifyInputOptions = {},
): ClassifiedInput | null {
  const trimmed = raw.trim();

  // 1. Cashu token (works on URLs, raw tokens, etc.)
  const cashuResult = extractCashuToken(trimmed);
  if (cashuResult) {
    return {
      direction: 'receive',
      type: 'cashu-token',
      encoded: cashuResult.encoded,
    };
  }

  // 2. BOLT11 invoice
  const bolt11Result = parseBolt11Invoice(trimmed);
  if (bolt11Result.valid) {
    return {
      direction: 'send',
      type: 'bolt11',
      invoice: bolt11Result.encoded,
      decoded: bolt11Result.decoded,
    };
  }

  // 3. Lightning address — lowercase before validation since the format
  // validator's local-part regex only accepts lowercase characters.
  const validateLnAddressFormat = buildLightningAddressFormatValidator({
    message: 'invalid',
    allowLocalhost: options.allowLocalhost ?? false,
  });
  const lowered = trimmed.toLowerCase();
  if (validateLnAddressFormat(lowered) === true) {
    return {
      direction: 'send',
      type: 'ln-address',
      address: lowered,
    };
  }

  return null;
}
