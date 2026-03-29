import { type PaymentRequest, decodePaymentRequest } from '@cashu/cashu-ts';

/**
 * Parses a Cashu payment request from the encoded string.
 * @param paymentRequest encoded payment request to parse
 */
export const parseCashuPaymentRequest = (
  paymentRequest: string,
): { valid: true; decoded: PaymentRequest } | { valid: false } => {
  try {
    const decoded = decodePaymentRequest(paymentRequest);
    return { valid: true, decoded };
  } catch {
    return { valid: false };
  }
};
