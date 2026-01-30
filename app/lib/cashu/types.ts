import type { CashuWallet } from '@cashu/cashu-ts';
import { z } from 'zod';
import { nullToUndefined } from '../zod';

const SerializedDLEQSchema = z.object({
  s: z.string(),
  e: z.string(),
  r: z.string().optional(),
});

const P2PKWitnessSchema = z.object({
  signatures: z.array(z.string()).optional(),
});

const HTLCWitnessSchema = z.object({
  preimage: z.string(),
  signatures: z.array(z.string()).optional(),
});

const WitnessSchema = z.union([
  z.string(),
  P2PKWitnessSchema,
  HTLCWitnessSchema,
]);

/**
 * Schema for a cashu proof.
 * Based on the Proof type from the @cashu/cashu-ts library.
 */
export const ProofSchema = z.object({
  /** Keyset id, used to link proofs to a mint and its MintKeys. */
  id: z.string(),
  /** Amount denominated in Satoshis. Has to match the amount of the mints signing key. */
  amount: z.number(),
  /** The initial secret that was (randomly) chosen for the creation of this proof. */
  secret: z.string(),
  /** The unblinded signature for this secret, signed by the mints private key. */
  C: z.string(),
  /** DLEQ proof. */
  dleq: nullToUndefined(SerializedDLEQSchema.optional()).optional(),
  /** Witness for P2PK or HTLC spending conditions. */
  witness: nullToUndefined(WitnessSchema.optional()).optional(),
});

/**
 * CAUTION: If the mint does not support spending conditions or a specific kind
 * of spending condition, proofs may be treated as a regular anyone-can-spend tokens.
 * Applications need to make sure to check whether the mint supports a specific kind of
 * spending condition by checking the mint's info endpoint.
 */
export const WELL_KNOWN_SECRET_KINDS = ['P2PK'] as const;

const WellKnownSecretKindSchema = z.enum(WELL_KNOWN_SECRET_KINDS);

export const NUT10SecretTagSchema = z
  .array(z.string())
  .nonempty()
  .refine((arr): arr is [string, ...string[]] => arr.length >= 1);

/**
 * Tags are part of the data in a NUT-10 secret and hold additional data committed to
 * and can be used for feature extensions.
 *
 * Tags are arrays with two or more strings being `["key", "value1", "value2", ...]`.
 *
Supported tags are:

 * - `sigflag`: <str> determines whether outputs have to be signed as well
 * - `n_sigs`: <int> specifies the minimum number of valid signatures expected
 * - `pubkeys`: <hex_str> are additional public keys that can provide signatures (allows multiple entries)
 * - `locktime`: <int> is the Unix timestamp of when the lock expires
 * - `refund`: <hex_str> are optional refund public keys that can exclusively spend after locktime (allows multiple entries)
 *
 * @example
 * ```typescript
 * const tag: NUT10SecretTag = ["sigflag", "SIG_INPUTS"];
 * ```
 */
export type NUT10SecretTag = z.infer<typeof NUT10SecretTagSchema>;

export const NUT10SecretSchema = z.object({
  /**
   * well-known secret kind
   * @example "P2PK"
   */
  kind: z.enum(WELL_KNOWN_SECRET_KINDS),
  /**
   * Expresses the spending condition specific to each kind
   * @example "0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7"
   */
  data: z.string(),
  /**
   * A unique random string
   * @example "859d4935c4907062a6297cf4e663e2835d90d97ecdd510745d32f6816323a41f"
   */
  nonce: z.string(),
  /**
   * Hold additional data committed to and can be used for feature extensions
   * @example [["sigflag", "SIG_INPUTS"]]
   */
  tags: z.array(NUT10SecretTagSchema).optional(),
});

/**
 * A NUT-10 secret in a proof is stored as a JSON string of a tuple:
 * [kind, {nonce, data, tags?}]
 *
 * When parsed, it is transformed into this object format.
 * @example
 * ```json
 * {
 *   "secret": "[\"P2PK\", {
 *     \"nonce\": \"859d4935c4907062a6297cf4e663e2835d90d97ecdd510745d32f6816323a41f\",
 *     \"data\": \"0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7\",
 *     \"tags\": [[\"sigflag\", \"SIG_INPUTS\"]]
 *   }]"
 * }
 * ```
 *
 * Gets parsed into:
 * ```json
 * {
 *   "kind": "P2PK",
 *   "data": "0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7",
 *   "nonce": "859d4935c4907062a6297cf4e663e2835d90d97ecdd510745d32f6816323a41f",
 *   "tags": [["sigflag", "SIG_INPUTS"]]
 * }
 * ```
 */
export type NUT10Secret = z.infer<typeof NUT10SecretSchema>;

export const RawNUT10SecretSchema = z.tuple([
  WellKnownSecretKindSchema,
  NUT10SecretSchema.omit({ kind: true }),
]);

/**
 * The raw data format of a NUT-10 secret as stored in a proof's secret field.
 * JSON.parse(proof.secret) of a valid NUT-10 secret returns this type.
 * @example
 * ```json
 * {
 *   "secret": "[\"P2PK\", {nonce: \"...", data: "...", tags: [["sigflag", "SIG_INPUTS"]]}]
 * }
 * ```
 *
 * Gets parsed into:
 * ```typescript
 * const secret: RawNUT10Secret = ["P2PK", {nonce: "...", data: "...", tags: [["sigflag", "SIG_INPUTS"]]}]
 * ```
 */
export type RawNUT10Secret = z.infer<typeof RawNUT10SecretSchema>;

/**
 * A plain secret is a random string
 *
 * @see https://github.com/cashubtc/nuts/blob/main/00.md for plain string secret format
 */
export type PlainSecret = string;

/**
 * A proof secret can be either be a random string or a NUT-10 secret
 *
 * @see https://github.com/cashubtc/nuts/blob/main/10.md for NUT-10 secret format
 * @see https://github.com/cashubtc/nuts/blob/main/00.md for plain string secret format
 */
export type ProofSecret =
  | {
      type: 'plain';
      secret: PlainSecret;
    }
  | {
      type: 'nut10';
      secret: NUT10Secret;
    };

/**
 * A P2PK secret requires a valid signature for the given pubkey
 *
 * @see https://github.com/cashubtc/nuts/blob/main/11.md for Pay-to-Pub-Key (P2PK) spending condition
 */
export type P2PKSecret = NUT10Secret & { kind: 'P2PK' };

/**
 * A class that represents the data fetched from the mint's
 * [NUT-06 info endpoint](https://github.com/cashubtc/nuts/blob/main/06.md)
 */
export type MintInfo = Awaited<ReturnType<CashuWallet['getMintInfo']>>;

/**
 * A subset of the supported currency units as defined by the Cashu protocol.
 * ISO 4217 currencies (and stablecoins pegged to those currencies) represent an amount in the Minor Unit of that currency
 *
 * The following units are supported:
 * - `sat`: Bitcoin's minor unit (1 BTC = 100,000,000 sat)
 * - `usd`: USD (minor unit: 2 decimals)
 *
 * @see https://github.com/cashubtc/nuts/blob/main/01.md#supported-currency-units
 */
export const CASHU_PROTOCOL_UNITS = ['sat', 'usd'] as const;

/** @see {@link CASHU_PROTOCOL_UNITS} */
export type CashuProtocolUnit = (typeof CASHU_PROTOCOL_UNITS)[number];

/**
 * A subset of the cashu [NUTs](https://github.com/cashubtc/nuts).
 */
export type NUT = 4 | 5 | 7 | 8 | 9 | 10 | 11 | 12 | 17 | 20;

/**
 * Web socket commands as defined by NUT-17.
 * @see https://github.com/cashubtc/nuts/blob/main/17.md for NUT-17 WebSocket commands
 */
export type NUT17WebSocketCommand =
  | 'bolt11_mint_quote'
  | 'bolt11_melt_quote'
  | 'proof_state';
