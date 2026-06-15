/**
 * Type dependencies the contract references but does NOT own.
 *
 * PR1 (contract-as-code) ships these as thin placeholders so the contract
 * typechecks standalone with ZERO new runtime/package deps. Each is wired to its
 * real source in a later slice (per the build plan: app-resident large modules
 * are NOT moved in PR1; external packages are imported only once they are in the
 * workspace + installed).
 */

// ---------------------------------------------------------------------------
// External package types (import once the deps are added to the package)
// ---------------------------------------------------------------------------

/**
 * Live Breez/Spark SDK instance held on a spark `Account`.
 * TODO(Slice-0): `import type { BreezSdk } from '@agicash/breez-sdk-spark'`
 * (add `@agicash/breez-sdk-spark` to the package deps + root catalog first).
 */
export type BreezSdk = unknown;

/**
 * Live cashu wallet handle (mint info / keysets / keys / seed) held on a cashu
 * `Account` — the per-mint protocol-metadata memo (§0 state kind 2).
 * TODO(Slice-3): import the real `ExtendedCashuWallet` from the SDK-internal
 * `lib/cashu` (extracted from `app/lib/cashu`).
 */
export type ExtendedCashuWallet = unknown;

/**
 * Spark network discriminant.
 * TODO(Slice-2): lift `SparkNetwork` verbatim from
 * `app/features/agicash-db/json-models/spark-account-details-db-data.ts`.
 */
export type SparkNetwork = 'MAINNET' | 'REGTEST';

/**
 * A raw cashu-ts protocol `Proof` (distinct from the domain `CashuProof`).
 * Carried by `CashuTokenMeltData.tokenProofs` (master: `z.array(ProofSchema)`).
 * TODO(Slice-2/3): `import type { Proof } from '@cashu/cashu-ts'` (alias here as
 * `CashuProtocolProof`); shape = `app/lib/cashu/types.ts#ProofSchema`.
 */
export type CashuProtocolProof = unknown;

/**
 * The `dleq` / `witness` sub-fields of a cashu-ts `Proof`, referenced by
 * `CashuProof`.
 * TODO(Slice-2/3): `import type { Proof } from '@cashu/cashu-ts'` and use
 * `Proof['dleq']` / `Proof['witness']` (matches `app/lib/cashu/types.ts#ProofSchema`).
 */
export type ProofDleq = unknown;
export type ProofWitness = unknown;

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

/**
 * `DistributedOmit` distributes `Omit` over a union (each member omits `K`).
 * Used by `RedactedAccount`.
 * TODO(Slice-2): `import type { DistributedOmit } from 'type-fest'` once the
 * package depends on `type-fest`. This local form is behaviour-equivalent.
 */
export type DistributedOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

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

/**
 * Decoded BOLT11 invoice carried by a `bolt11` `ParsedDestination`.
 * Shape = `app/lib/bolt11/index.ts#DecodedBolt11` (verbatim).
 * TODO(Slice-2): import the real type from the SDK-internal `lib/bolt11`
 * (extracted from `app/lib/bolt11`).
 */
export type Bolt11Invoice = {
  /** Invoice amount in millisatoshis, or undefined for amountless invoices. */
  amountMsat: number | undefined;
  /** Invoice amount in satoshis, or undefined for amountless invoices. */
  amountSat: number | undefined;
  /** Invoice creation time, Unix epoch milliseconds. */
  createdAtUnixMs: number;
  /** Invoice expiry time, Unix epoch milliseconds. */
  expiryUnixMs: number;
  /** Network the invoice is for (e.g. "bitcoin"/"testnet"), or undefined. */
  network: string | undefined;
  /** Invoice description/memo, or undefined. */
  description: string | undefined;
  /** Public key of the payee node. */
  payeeNodeKey: string;
  /** Payment hash of the invoice. */
  paymentHash: string;
};

/**
 * Parsed cashu token metadata carried by a `cashu-token` `ParsedDestination`.
 * Master = `@cashu/cashu-ts`'s `TokenMetadata` (returned by `extractCashuToken`).
 * TODO(Slice-2/3): `import type { TokenMetadata } from '@cashu/cashu-ts'` (alias
 * to `ParsedToken`); `extractCashuToken` returns `{ encoded; metadata: TokenMetadata }`.
 */
export type ParsedToken = {
  /** the re-encoded token string */
  encoded: string;
  /** cashu-ts TokenMetadata (mint/unit/amount summary) */
  metadata: unknown;
};
