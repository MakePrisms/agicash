import bolt11Decoder, { type Section } from 'light-bolt11-decoder';

export type DecodedBolt11 = {
  amountMsat: number | undefined;
  amountSat: number | undefined;
  expiryUnixMs: number | undefined;
  network: string | undefined;
  description: string | undefined;
  paymentHash: string;
};

/**
 * Decodes a BOLT11 invoice
 * @param invoice invoice to decode
 */
export const decodeBolt11 = (invoice: string): DecodedBolt11 => {
  const { sections } = bolt11Decoder.decode(invoice.replace(/^lightning:/, ''));

  const amountSection = findSection(sections, 'amount');
  const amountMsat = amountSection?.value
    ? Number(amountSection.value)
    : undefined;
  const amountSat = amountMsat ? amountMsat / 1000 : undefined;

  const expirySection = findSection(sections, 'expiry');
  const timestampSection = findSection(sections, 'timestamp');

  let expiryUnixSec: number | undefined = undefined;
  if (expirySection && timestampSection) {
    expiryUnixSec = timestampSection.value + expirySection.value;
  }

  const expiryUnixMs = expiryUnixSec ? expiryUnixSec * 1000 : undefined;

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
    expiryUnixMs,
    network,
    description,
    paymentHash,
  };
};

/**
 * Checks if a string is a valid BOLT11 invoice
 * @param invoice invoice to check
 */
export const parseBolt11Invoice = (
  invoice: string,
): { valid: true; decoded: DecodedBolt11 } | { valid: false } => {
  try {
    const decoded = decodeBolt11(invoice);
    return { valid: true, decoded };
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
