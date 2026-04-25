import { type DecodedBolt11, parseBolt11Invoice } from '~/lib/bolt11';
import { extractCashuToken } from '~/lib/cashu/token';
import { buildLightningAddressFormatValidator } from '~/lib/lnurl';

const validateLnAddressFormat = buildLightningAddressFormatValidator({
  message: 'invalid',
  allowLocalhost: import.meta.env.MODE === 'development',
});

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

export function classifyInput(raw: string): ClassifiedInput | null {
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
      invoice: bolt11Result.invoice,
      decoded: bolt11Result.decoded,
    };
  }

  // 3. Lightning address
  if (validateLnAddressFormat(trimmed) === true) {
    return {
      direction: 'send',
      type: 'ln-address',
      address: trimmed.toLowerCase(),
    };
  }

  return null;
}
