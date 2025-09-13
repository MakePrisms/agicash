import type { CashuWallet } from '@cashu/cashu-ts';
import { z } from 'zod';

/**
 * CAUTION: If the mint does not support spending conditions or a specific kind
 * of spending condition, proofs may be treated as a regular anyone-can-spend tokens.
 * Applications need to make sure to check whether the mint supports a specific kind of
 * spending condition by checking the mint's info endpoint.
 */
export const WELL_KNOWN_SECRET_KINDS = ['P2PK', 'HTLC'] as const;

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

const AdditionalP2PKConditionsSchema = z.object({
  /**
   * Unix timestamp after which refund keys can be used to spend the proof
   * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK locktime
   * @example 1672531200 // January 1, 2023 00:00:00 UTC
   */
  locktime: z.number().optional(),
  /**
   * Additional public keys for multi-signature scenarios (33-byte hex strings)
   * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK multi-sig
   * @example ["0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7"]
   */
  pubkeys: z.array(z.string()).optional(),
  /**
   * Refund public keys that can exclusively spend after locktime expires (33-byte hex strings)
   * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK refund mechanism
   * @example ["02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0"]
   */
  refundKeys: z.array(z.string()).optional(),
  /**
   * Minimum number of valid signatures required for multi-sig scenarios
   * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK threshold signatures
   * @example 2 // Requires 2 out of n signatures
   */
  requiredSigs: z.number().optional(),
  /**
   * Determines what part of the transaction must be signed
   * - SIG_INPUTS: Only inputs need to be signed
   * - SIG_ALL: Both inputs and outputs need to be signed
   * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK signature flags
   * @example "SIG_INPUTS"
   */
  sigFlag: z.enum(['SIG_INPUTS', 'SIG_ALL']).optional(),
});

/**
 * Additional P2PK conditions that can be applied to spending conditions.
 * These conditions extend the basic P2PK functionality with features like:
 * - Multi-signature requirements
 * - Time-based refund mechanisms
 * - Signature flags
 *
 * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK specification
 */
export type AdditionalP2PKConditions = z.infer<
  typeof AdditionalP2PKConditionsSchema
>;

const P2PKSpendingConditionDataSchema = z.object({
  /**
   * Well-known secret kind for Pay-to-Public-Key spending conditions
   * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK specification
   */
  kind: z.literal('P2PK'),
  /**
   * 33-byte hex-encoded public key of the recipient who can spend this proof.
   * Only the holder of the corresponding private key can create valid signatures to unlock this proof.
   * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK data format
   * @example "0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7"
   */
  data: z.string(),
  /**
   * Additional optional conditions that extend P2PK functionality.
   * Can include multi-sig requirements, timelocks, and refund mechanisms.
   * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK conditions
   */
  conditions: AdditionalP2PKConditionsSchema.nullable(),
});

const HTLCSpendingConditionDataSchema = z.object({
  /**
   * Well-known secret kind for Hash Time Lock Contract spending conditions
   * @see https://github.com/cashubtc/nuts/blob/main/14.md for NUT-14 HTLC specification
   */
  kind: z.literal('HTLC'),
  /**
   * SHA256 hash of the preimage that must be revealed to unlock this proof.
   * The spender must provide the preimage that hashes to this value.
   * @see https://github.com/cashubtc/nuts/blob/main/14.md for NUT-14 HTLC hash locks
   * @example "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3" // SHA256 of "hello"
   */
  data: z.string(),
  /**
   * Additional optional conditions that can be applied to HTLCs.
   * These include the same conditions as P2PK: multi-sig, timelocks, refund mechanisms.
   * @see https://github.com/cashubtc/nuts/blob/main/14.md for NUT-14 HTLC conditions
   */
  conditions: AdditionalP2PKConditionsSchema.nullable(),
});

export const SpendingConditionDataSchema = z.union([
  P2PKSpendingConditionDataSchema,
  HTLCSpendingConditionDataSchema,
]);

/**
 * P2PK spending condition data for locking proofs to a specific public key.
 * This creates proofs that can only be spent by providing a valid signature
 * from the corresponding private key.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK specification
 *
 * @example
 * ```typescript
 * const p2pkCondition: P2PKSpendingConditionData = {
 *   kind: 'P2PK',
 *   data: '0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7',
 *   conditions: {
 *     locktime: 1672531200,
 *     requiredSigs: 1,
 *     sigFlag: 'SIG_INPUTS'
 *   }
 * };
 * ```
 */
export type P2PKSpendingConditionData = z.infer<
  typeof P2PKSpendingConditionDataSchema
>;

/**
 * HTLC spending condition data for creating hash time lock contracts.
 * This creates proofs that can be spent by revealing a preimage or
 * by refund keys after a timelock expires.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/14.md for NUT-14 HTLC specification
 *
 * @example
 * ```typescript
 * const htlcCondition: HTLCSpendingConditionData = {
 *   kind: 'HTLC',
 *   data: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
 *   conditions: {
 *     locktime: 1672531200,
 *     refundKeys: ['02c020067db727d586bc3183ed7d04a5f7d2f25329b2f825a38292e2e28d47a59b0']
 *   }
 * };
 * ```
 */
export type HTLCSpendingConditionData = z.infer<
  typeof HTLCSpendingConditionDataSchema
>;

/**
 * Union type for all supported spending condition data types.
 * Currently supports P2PK and HTLC spending conditions as defined in NUTs 11 and 14.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/10.md for NUT-10 spending conditions overview
 */
export type SpendingConditionData = z.infer<typeof SpendingConditionDataSchema>;

/**
 * P2PK unlocking data schema for claiming P2PK proofs.
 * Contains the witness data needed to satisfy P2PK spending conditions.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK unlocking
 */
const P2PKUnlockingDataSchema = z.object({
  /**
   * Unlocking data kind matching the spending condition type
   */
  kind: z.literal('P2PK'),
  /**
   * Private keys used to create signatures for unlocking P2PK proofs (33-byte hex).
   * Each key corresponds to a public key in the spending condition.
   * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK signature requirements
   * @example ["1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12"]
   */
  signingKeys: z.array(z.string()),
  /**
   * Additional signatures required for multi-signature scenarios.
   * Used when conditions specify multiple pubkeys or threshold signatures.
   * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK multi-sig unlocking
   * @example ["3045022100...", "3044022000..."] // DER-encoded signatures
   */
  additionalSignatures: z.array(z.string()).optional(),
});

/**
 * HTLC unlocking data schema for claiming HTLC proofs.
 * Contains witness data for both preimage-based and refund-based unlocking.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/14.md for NUT-14 HTLC unlocking
 */
const HTLCUnlockingDataSchema = z.object({
  /**
   * Unlocking data kind matching the spending condition type
   */
  kind: z.literal('HTLC'),
  /**
   * Preimages that hash to the values specified in HTLC spending conditions.
   * Required for the primary unlock path (before locktime expiration).
   * @see https://github.com/cashubtc/nuts/blob/main/14.md for NUT-14 HTLC preimage unlock
   * @example ["hello"] // String that when SHA256 hashed matches the HTLC data
   */
  preimages: z.array(z.string()),
  /**
   * Signatures required along with preimages for the main unlock path.
   * Used when conditions require both preimage revelation and signature verification.
   * @see https://github.com/cashubtc/nuts/blob/main/14.md for NUT-14 HTLC signature requirements
   * @example ["3045022100...", "3044022000..."] // DER-encoded signatures
   */
  preimageSignatures: z.array(z.string()).optional(),
  /**
   * Signatures from refund keys used after locktime expires.
   * Enables the refund path when the primary unlock conditions cannot be met.
   * @see https://github.com/cashubtc/nuts/blob/main/14.md for NUT-14 HTLC refund mechanism
   * @example ["3045022100...", "3044022000..."] // DER-encoded signatures from refund keys
   */
  refundSignatures: z.array(z.string()).optional(),
});

/**
 * Union schema for all unlocking data types.
 * Supports witness data for P2PK and HTLC spending conditions.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/10.md for NUT-10 witness data overview
 */
export const UnlockingDataSchema = z.union([
  P2PKUnlockingDataSchema,
  HTLCUnlockingDataSchema,
]);

/**
 * P2PK unlocking data for claiming proofs locked to public keys.
 * Contains the private keys and signatures needed to satisfy P2PK spending conditions.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK unlocking specification
 *
 * @example
 * ```typescript
 * const p2pkUnlock: P2PKUnlockingData = {
 *   kind: 'P2PK',
 *   signingKeys: ['1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12'],
 *   additionalSignatures: ['3045022100...'] // For multi-sig scenarios
 * };
 * ```
 */
export type P2PKUnlockingData = z.infer<typeof P2PKUnlockingDataSchema>;

/**
 * HTLC unlocking data for claiming hash time lock contract proofs.
 * Contains preimages and signatures for both primary and refund unlock paths.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/14.md for NUT-14 HTLC unlocking specification
 *
 * @example
 * ```typescript
 * // Primary unlock path (with preimage)
 * const htlcUnlock: HTLCUnlockingData = {
 *   kind: 'HTLC',
 *   preimages: ['hello'], // Preimage that hashes to HTLC condition
 *   preimageSignatures: ['3045022100...'] // If signature also required
 * };
 *
 * // Refund path (after locktime)
 * const htlcRefund: HTLCUnlockingData = {
 *   kind: 'HTLC',
 *   preimages: [], // Empty for refund path
 *   refundSignatures: ['3045022100...'] // Signatures from refund keys
 * };
 * ```
 */
export type HTLCUnlockingData = z.infer<typeof HTLCUnlockingDataSchema>;

/**
 * Union type for all unlocking data needed to claim/spend proofs with spending conditions.
 * This witness data proves that the spender satisfies the conditions specified in the proof's secret.
 *
 * The mint validates this unlocking data against the spending conditions before authorizing
 * the transaction. Each proof in a transaction must provide valid unlocking data.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/10.md for NUT-10 spending conditions and witness data
 * @see https://github.com/cashubtc/nuts/blob/main/11.md for NUT-11 P2PK unlocking
 * @see https://github.com/cashubtc/nuts/blob/main/14.md for NUT-14 HTLC unlocking
 */
export type UnlockingData = z.infer<typeof UnlockingDataSchema>;

/**
 * A class that represents the data fetched from the mint's
 * [NUT-06 info endpoint](https://github.com/cashubtc/nuts/blob/main/06.md)
 */
export type MintInfo = Awaited<ReturnType<CashuWallet['getMintInfo']>>;

/**
 * The units that are determined by the soft-consensus of cashu mints and wallets.
 * These units are not definite as they are not defined in NUTs directly.
 * The following units generally mean:
 * - `sat`: satoshis
 * - `usd`: cents in USD
 */
export type CashuProtocolUnit = 'sat' | 'usd';

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
