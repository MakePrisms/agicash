import { parseCashuPaymentRequest } from '@agicash/cashu';
import { type DecodedBolt11, parseBolt11Invoice } from '@agicash/utils/bolt11';
import type { Money } from '@agicash/utils/money';
import { type Contact, isContact } from '../contacts/contact';
import { buildLightningAddressFormatValidator } from '../lightning-address';
import { isValidLightningAddress } from '../lnurl';
import { validateBolt11 } from './validation';

export type SendDestination =
  | {
      sendType: 'BOLT11_INVOICE';
      destination: string;
      destinationDisplay: string;
      destinationDetails?: null;
      amount: Money | null;
      decoded: DecodedBolt11;
    }
  | {
      sendType: 'LN_ADDRESS';
      destination: null;
      destinationDisplay: string;
      destinationDetails: { lnAddress: string };
      amount?: null;
    }
  | {
      sendType: 'AGICASH_CONTACT';
      destination: null;
      destinationDisplay: string;
      destinationDetails: Contact;
      amount?: null;
    };

export type ResolveSendDestinationResult =
  | { success: true; data: SendDestination }
  | { success: false; error: string };

export type ResolveSendDestinationOptions = {
  /**
   * Accept zero-amount BOLT11 invoices (the sender supplies the amount later,
   * e.g. spark accounts). Defaults to false.
   */
  allowZeroAmountBolt11?: boolean;
  /**
   * Accept `name@localhost[:port]` lightning addresses (local development).
   * Hosts derive this from their environment. Defaults to false.
   */
  allowLocalhost?: boolean;
};

/**
 * Resolves a pasted/typed string or an Agicash contact into a typed
 * {@link SendDestination}: a contact, a lightning address (format + network
 * validated), or a validated BOLT11 invoice. Cashu payment requests are
 * detected and rejected (sending to them is unsupported). Returns a
 * success/error result rather than throwing.
 *
 * The send-flow counterpart to `classifyInput` (the scan classifier), built on
 * the same parsing primitives.
 */
export async function resolveSendDestination(
  input: string | Contact,
  {
    allowZeroAmountBolt11 = false,
    allowLocalhost = false,
  }: ResolveSendDestinationOptions = {},
): Promise<ResolveSendDestinationResult> {
  if (isContact(input)) {
    return {
      success: true,
      data: {
        sendType: 'AGICASH_CONTACT',
        destination: null,
        destinationDisplay: input.username,
        destinationDetails: input,
      },
    };
  }

  const validateLightningAddressFormat = buildLightningAddressFormatValidator({
    message: 'Invalid lightning address',
    allowLocalhost,
  });
  // LUD-16 addresses are case-insensitive, but the format validator's local-part
  // regex only accepts lowercase, so normalize first (matches classifyInput).
  const loweredInput = input.toLowerCase();
  if (validateLightningAddressFormat(loweredInput) === true) {
    const isValid = await isValidLightningAddress(loweredInput);
    if (!isValid) {
      return { success: false, error: 'Invalid lightning address' };
    }
    return {
      success: true,
      data: {
        sendType: 'LN_ADDRESS',
        destination: null,
        destinationDisplay: loweredInput,
        destinationDetails: { lnAddress: loweredInput },
      },
    };
  }

  const bolt11 = parseBolt11Invoice(input);
  if (bolt11.valid) {
    const validated = validateBolt11(bolt11.decoded, {
      allowZeroAmount: allowZeroAmountBolt11,
    });
    if (!validated.valid) {
      return { success: false, error: validated.error };
    }
    const { encoded } = bolt11;
    return {
      success: true,
      data: {
        sendType: 'BOLT11_INVOICE',
        destination: encoded,
        destinationDisplay: `${encoded.slice(0, 10)}...${encoded.slice(-6)}`,
        amount: validated.amount,
        decoded: bolt11.decoded,
      },
    };
  }

  if (parseCashuPaymentRequest(input).valid) {
    return {
      success: false,
      error: 'Cashu payment requests are not supported',
    };
  }

  return {
    success: false,
    error: 'Invalid destination. Must be a lightning address or bolt11 invoice',
  };
}
