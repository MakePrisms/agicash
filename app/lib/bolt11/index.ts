import bolt11Decoder, { type Section } from 'light-bolt11-decoder';

// Per BOLT11 spec, the default expiry is 3600 seconds (1 hour) when the `x` tag is absent.
// See https://github.com/lightning/bolts/blob/master/11-payment-encoding.md
const DEFAULT_EXPIRY_SECONDS = 3600;

export type DecodedBolt11 = {
  amountMsat: number | undefined;
  amountSat: number | undefined;
  createdAtUnixMs: number;
  expiryUnixMs: number;
  network: string | undefined;
  description: string | undefined;
  paymentHash: string;
};

/**
 * Decodes a BOLT11 invoice
 * @param invoice invoice to decode
 */
export const decodeBolt11 = (invoice: string): DecodedBolt11 => {
  const { sections } = bolt11Decoder.decode(invoice);

  const amountSection = findSection(sections, 'amount');
  const amountMsat = amountSection?.value
    ? Number(amountSection.value)
    : undefined;
  const amountSat = amountMsat ? amountMsat / 1000 : undefined;

  const timestampSection = findSection(sections, 'timestamp');
  if (!timestampSection) {
    throw new Error('Invalid lightning invoice: missing timestamp');
  }
  const createdAtUnixMs = timestampSection.value * 1000;

  const expirySection = findSection(sections, 'expiry');
  const expirySeconds = expirySection?.value ?? DEFAULT_EXPIRY_SECONDS;
  const expiryUnixMs = (timestampSection.value + expirySeconds) * 1000;

  const networkSection = findSection(sections, 'coin_network')?.value;
  const networkPrefix = networkSection?.bech32;
  const network = networkPrefix ? getNetwork(networkPrefix) : undefined;

  const descriptionSection = findSection(sections, 'description');
  const description = descriptionSection?.value;

  const paymentHashSection = findSection(sections, 'payment_hash');
  const paymentHash = paymentHashSection?.value;
  if (!paymentHash) {
    throw new Error('Invalid lightning invoice: missing payment hash');
  }

  return {
    amountMsat,
    amountSat,
    createdAtUnixMs,
    expiryUnixMs,
    network,
    description,
    paymentHash,
  };
};

/**
 * Checks if a string is a valid BOLT11 invoice.
 * Returns the cleaned invoice (without lightning: prefix) and decoded data on success.
 * @param invoice invoice to check (accepts optional lightning: prefix, case-insensitive)
 */
export const parseBolt11Invoice = (
  invoice: string,
):
  | { valid: true; encoded: string; decoded: DecodedBolt11 }
  | { valid: false } => {
  try {
    const cleaned = invoice.replace(/^lightning:/i, '');
    const decoded = decodeBolt11(cleaned);
    return { valid: true, encoded: cleaned, decoded };
  } catch {
    return { valid: false };
  }
};

const findSection = <T extends Section['name']>(
  sections: Section[],
  sectionName: T,
): Extract<Section, { name: T }> | undefined => {
  return sections.find((s) => s.name === sectionName) as
    | Extract<Section, { name: T }>
    | undefined;
};

/**
 * @see https://github.com/lightning/bolts/blob/master/11-payment-encoding.md#human-readable-part
 */
const getNetwork = (networkPrefix: string) => {
  switch (networkPrefix) {
    case 'bc':
      return 'bitcoin';
    case 'tb':
      return 'testnet';
    case 'tbs':
      return 'signet';
    case 'bcrt':
      return 'regtest';
    default:
      return 'unknown';
  }
};
