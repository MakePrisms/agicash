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
// External package types (RESOLVED in Slice 3 — the live wallet handles)
// ---------------------------------------------------------------------------

import type { BreezSdk as BreezSdkType } from '@agicash/breez-sdk-spark';
import type { Proof } from '@cashu/cashu-ts';
// The live `ExtendedCashuWallet` is the SDK-internal cashu-ts wallet subclass; re-exported
// from `app/lib/cashu/utils` (SDK-internal, §12) — same single-source re-export as
// `internal/lib-cashu-wallet.ts`. Importing the TYPE here keeps `Account.wallet` correctly
// typed without `types/` depending on `internal/`.
import type { ExtendedCashuWallet as ExtendedCashuWalletClass } from '../../../../apps/web-wallet/app/lib/cashu/utils';

/**
 * Live Breez/Spark SDK instance held on a spark `Account`. Resolved (Slice 3) to the real
 * `BreezSdk` from `@agicash/breez-sdk-spark` (a native/WASM package — only the TYPE is
 * imported here; the runtime is dynamically loaded by `internal/spark-wallet.ts`).
 */
export type BreezSdk = BreezSdkType;

/**
 * Live cashu wallet handle (mint info / keysets / keys / seed) held on a cashu `Account` —
 * the per-mint protocol-metadata memo (§0 state kind 2). Resolved (Slice 3) to the real
 * `ExtendedCashuWallet` (cashu-ts `Wallet` subclass) from the SDK-internal `lib/cashu`.
 */
export type ExtendedCashuWallet = ExtendedCashuWalletClass;

/**
 * Spark network discriminant. Lifted verbatim from
 * `app/features/agicash-db/json-models/spark-account-details-db-data.ts`.
 */
export type SparkNetwork = 'MAINNET' | 'REGTEST';

/**
 * A raw cashu-ts protocol `Proof` (distinct from the domain `CashuProof`).
 * Carried by `CashuTokenMeltData.tokenProofs` (master: `z.array(ProofSchema)`).
 * Resolved (Slice 3) to cashu-ts `Proof`.
 */
export type CashuProtocolProof = Proof;

/**
 * The `dleq` / `witness` sub-fields of a cashu-ts `Proof`, referenced by `CashuProof`.
 * Resolved (Slice 3) to `Proof['dleq']` / `Proof['witness']` (matches
 * `app/lib/cashu/types.ts#ProofSchema`).
 */
export type ProofDleq = Proof['dleq'];
export type ProofWitness = Proof['witness'];

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

/**
 * Pluggable storage adapter (web = browser, mcp = fs/sqlite) threaded into the
 * OpenSecret SDK and used for session resume.
 * TODO(Slice-0): replace with the real `StorageAdapter` type from
 * `@agicash/opensecret-sdk` (its `configure({ storage })` contract).
 */
export type StorageAdapter = {
  /** Read a stored value by key (null if absent); may be sync or async. */
  getItem(key: string): Promise<string | null> | string | null;
  /** Write a value under a key; may be sync or async. */
  setItem(key: string, value: string): Promise<void> | void;
  /** Delete a stored value by key; may be sync or async. */
  removeItem(key: string): Promise<void> | void;
};
