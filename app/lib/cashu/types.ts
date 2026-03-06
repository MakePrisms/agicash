import type { Wallet } from '@cashu/cashu-ts';
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
 * A class that represents the data fetched from the mint's
 * [NUT-06 info endpoint](https://github.com/cashubtc/nuts/blob/main/06.md)
 */
export type MintInfo = ReturnType<Wallet['getMintInfo']>;

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
