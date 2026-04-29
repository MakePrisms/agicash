import { parseBolt11Invoice } from '~/lib/bolt11';
import { parseCashuPaymentRequest } from '~/lib/cashu';
import { isValidLightningAddress } from '~/lib/lnurl';
import type { Money } from '~/lib/money';
import { type Contact, isContact } from '../contacts/contact';
import { validateBolt11, validateLightningAddressFormat } from './validation';

/**
 * Fully-resolved destination ready to be spread into the send store's initial
 * state or applied via `set(...)` from the runtime `selectDestination` action.
 *
 * Shapes here mirror the discriminated union in send-store's `State` so the
 * loader can produce a value the store accepts without any further mapping.
 */
export type ResolvedDestination =
  | {
      sendType: 'BOLT11_INVOICE';
      destination: string;
      destinationDisplay: string;
      destinationDetails?: null;
      amount: Money | null;
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

export type ResolveResult =
  | { success: true; data: ResolvedDestination }
  | { success: false; error: string };

/**
 * Parses and validates a destination input (raw string from QR/hash/paste, or
 * a Contact object from the contact picker), performing any async validation
 * required (e.g. LNURL endpoint reachability for lightning addresses).
 *
 * Used by both the `clientLoader` (for URL hash entry) and the runtime
 * `selectDestination` action so both code paths share a single source of
 * truth for "what does this input mean."
 */
export async function resolveDestination(
  input: string | Contact,
  { allowZeroAmountBolt11 = false }: { allowZeroAmountBolt11?: boolean } = {},
): Promise<ResolveResult> {
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

  if (validateLightningAddressFormat(input) === true) {
    const isValid = await isValidLightningAddress(input);
    if (!isValid) {
      return { success: false, error: 'Invalid lightning address' };
    }
    return {
      success: true,
      data: {
        sendType: 'LN_ADDRESS',
        destination: null,
        destinationDisplay: input,
        destinationDetails: { lnAddress: input },
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
        destinationDisplay: `${encoded.slice(0, 6)}...${encoded.slice(-4)}`,
        amount: validated.amount,
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
    error:
      'Invalid destination. Must be lightning address, bolt11 invoice or cashu payment request',
  };
}
