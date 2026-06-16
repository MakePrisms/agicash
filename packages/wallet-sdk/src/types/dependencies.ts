/**
 * Type dependencies the contract references but does NOT own.
 *
 * PR1 (contract-as-code) shipped these as thin placeholders so the contract
 * typechecked standalone with ZERO new runtime/package deps. Task 6 (S4) wires
 * each placeholder to its real source now that the libs + packages are in.
 */

import type { Proof, TokenMetadata } from '@cashu/cashu-ts';

import type { DecodedBolt11 } from '../internal/lib/bolt11';
import type { ExtendedCashuWallet as RealExtendedCashuWallet } from '../internal/lib/cashu';

// ---------------------------------------------------------------------------
// External package types
// ---------------------------------------------------------------------------

/** Live Breez/Spark SDK instance held on a spark `Account`. */
export type { BreezSdk } from '@agicash/breez-sdk-spark';

/** Live cashu wallet handle (mint info / keysets / keys / seed) held on a cashu `Account`. */
export type ExtendedCashuWallet = RealExtendedCashuWallet;

/**
 * Spark network discriminant.
 */
export type SparkNetwork = 'MAINNET' | 'REGTEST';

/** A raw cashu-ts protocol `Proof` (distinct from the domain `CashuProof`). */
export type CashuProtocolProof = Proof;
/** The `dleq` sub-field of a cashu-ts `Proof`. */
export type ProofDleq = Proof['dleq'];
/** The `witness` sub-field of a cashu-ts `Proof`. */
export type ProofWitness = Proof['witness'];

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

/** `DistributedOmit` distributes `Omit` over a union (each member omits `K`). */
export type { DistributedOmit } from 'type-fest';

/**
 * Supabase `Json` scalar — referenced by the (internal) transaction-details
 * parser surface. Public types don't use it; kept here for the parser seam.
 * TODO(Slice-4): import `Json` from the lifted `agicash-db/database.ts` types.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ---------------------------------------------------------------------------
// Parsed-destination payload types (scan, §3)
// ---------------------------------------------------------------------------

/** Decoded BOLT11 invoice carried by a `bolt11` `ParsedDestination`. */
export type Bolt11Invoice = DecodedBolt11;

/** Parsed cashu token metadata carried by a `cashu-token` `ParsedDestination`. */
export type ParsedToken = { encoded: string; metadata: TokenMetadata };
