import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { bech32 } from '@scure/base';
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
  payeeNodeKey: string;
  paymentHash: string;
};

/**
 * Decodes a BOLT11 invoice. Strips an optional `lightning:` prefix
 * (case-insensitive per BIP21) and lowercases the result — bech32 requires
 * uniform case, and lowercase is the canonical form. The cleaned bech32
 * string is returned alongside the decoded fields.
 * @param invoice invoice to decode (accepts optional lightning: prefix, case-insensitive)
 */
export const decodeBolt11 = (
  invoice: string,
): { encoded: string; decoded: DecodedBolt11 } => {
  const encoded = invoice.replace(/^lightning:/i, '').toLowerCase();
  const { sections } = bolt11Decoder.decode(encoded);

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

  const payeeNodeKey = recoverPayeeNodeKey(encoded);

  const paymentHashSection = findSection(sections, 'payment_hash');
  const paymentHash = paymentHashSection?.value;
  if (!paymentHash) {
    throw new Error('Invalid lightning invoice: missing payment hash');
  }

  return {
    encoded,
    decoded: {
      amountMsat,
      amountSat,
      createdAtUnixMs,
      expiryUnixMs,
      network,
      description,
      payeeNodeKey,
      paymentHash,
    },
  };
};

/**
 * Checks if a string is a valid BOLT11 invoice. Returns the cleaned bech32
 * form and the decoded fields on success.
 * @param invoice invoice to check (accepts optional lightning: prefix, case-insensitive)
 */
export const parseBolt11Invoice = (
  invoice: string,
):
  | { valid: true; encoded: string; decoded: DecodedBolt11 }
  | { valid: false } => {
  try {
    const { encoded, decoded } = decodeBolt11(invoice);
    return { valid: true, encoded, decoded };
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
 * Packs an array of 5-bit groups into bytes, zero-padding any trailing
 * partial byte. This is the form that BOLT11 hashes for signing — the
 * data part may have a bit-length that isn't a multiple of 8, so a
 * strict 5→8 base converter (e.g. `bech32.fromWords`) refuses it.
 */
const packFiveBitsToBytes = (words: number[]): Uint8Array => {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const word of words) {
    buffer = (buffer << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  if (bits > 0) {
    out.push((buffer << (8 - bits)) & 0xff);
  }
  return new Uint8Array(out);
};

/**
 * Recovers the payee node pubkey from a BOLT11 invoice's signature.
 *
 * Per BOLT11, every invoice is signed and the destination pubkey is
 * derivable from the signature alone — the optional `n` tag is rarely
 * included. This does ECDSA recovery against the canonical preimage
 * `sha256(hrp_utf8 || data_5bit_packed_to_bytes)`.
 *
 * @returns 33-byte compressed pubkey as lowercase hex.
 * @throws if the input is not a decodable bech32 BOLT11 invoice.
 */
const recoverPayeeNodeKey = (invoice: string): string => {
  const { prefix, words } = bech32.decode(
    invoice as `${string}1${string}`,
    Number.MAX_SAFE_INTEGER,
  );
  const sigBytes = bech32.fromWordsUnsafe(words.slice(-104));
  if (!sigBytes) {
    throw new Error('Invalid lightning invoice: malformed signature');
  }
  const dataBytes = packFiveBitsToBytes(words.slice(0, -104));
  const hrpBytes = new TextEncoder().encode(prefix);
  const preimage = new Uint8Array(hrpBytes.length + dataBytes.length);
  preimage.set(hrpBytes, 0);
  preimage.set(dataBytes, hrpBytes.length);
  const hash = sha256(preimage);
  // BOLT11 stores the signature as r||s||recid (65 bytes). noble's
  // 'recovered' format expects recid as the first byte, so reorder.
  const recovered = new Uint8Array(65);
  recovered[0] = sigBytes[64];
  recovered.set(sigBytes.subarray(0, 64), 1);
  const sig = secp256k1.Signature.fromBytes(recovered, 'recovered');
  return bytesToHex(sig.recoverPublicKey(hash).toBytes(true));
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
