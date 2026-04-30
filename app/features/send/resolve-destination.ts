import { parseBolt11Invoice } from '~/lib/bolt11';
import { parseCashuPaymentRequest } from '~/lib/cashu';
import { isValidLightningAddress } from '~/lib/lnurl';
import type { Money } from '~/lib/money';
import { type Contact, isContact } from '../contacts/contact';
import { validateBolt11, validateLightningAddressFormat } from './validation';

export type SendDestination =
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

type ResolveResult =
  | { success: true; data: SendDestination }
  | { success: false; error: string };

export async function resolveSendDestination(
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
    error: 'Invalid destination. Must be a lightning address or bolt11 invoice',
  };
}
