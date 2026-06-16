/**
 * `wallet.accounts.details` JSON schemas + row type guards.
 *
 * The generated `accounts.details` column is a generic `Json`; these zod schemas
 * (ported from the web's `agicash-db/json-models/*`) parse it per account type,
 * and the guards narrow a DB row by its `type` discriminant (the repository
 * parses `details` via the matching schema after narrowing).
 */
import { z } from 'zod/mini';
import type { AgicashDbAccountWithProofs } from './database';

/** `wallet.accounts.details` for a cashu account. */
export const CashuAccountDetailsDbDataSchema = z.object({
  mint_url: z.string(),
  is_test_mint: z.boolean(),
  keyset_counters: z.record(z.string(), z.number()),
});
export type CashuAccountDetailsDbData = z.infer<
  typeof CashuAccountDetailsDbDataSchema
>;

/** `wallet.accounts.details` for a spark account. */
export const SparkAccountDetailsDbDataSchema = z.object({
  network: z.enum(['MAINNET', 'REGTEST']),
});
export type SparkAccountDetailsDbData = z.infer<
  typeof SparkAccountDetailsDbDataSchema
>;

/** A DB account row (with proofs) narrowed to cashu by its `type` discriminant. */
export type CashuDbAccount = AgicashDbAccountWithProofs & { type: 'cashu' };
/** A DB account row (with proofs) narrowed to spark by its `type` discriminant. */
export type SparkDbAccount = AgicashDbAccountWithProofs & { type: 'spark' };

/** True if the DB account row is a cashu account (narrows `type`). */
export function isCashuAccount(
  account: AgicashDbAccountWithProofs,
): account is CashuDbAccount {
  return account.type === 'cashu';
}

/** True if the DB account row is a spark account (narrows `type`). */
export function isSparkAccount(
  account: AgicashDbAccountWithProofs,
): account is SparkDbAccount {
  return account.type === 'spark';
}
