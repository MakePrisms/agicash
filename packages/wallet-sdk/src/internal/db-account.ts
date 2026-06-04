/**
 * Internal DB ⇄ domain `Account` mapping — Slice 2 (accounts + scan).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/accounts/account-repository.ts` (`toAccount`) +
 * `apps/web-wallet/app/features/agicash-db/database.ts` (the row types + `isCashuAccount`/
 * `isSparkAccount` guards) + the `json-models/*-account-details-db-data.ts` schemas. Master
 * maps a `wallet.accounts` row (joined with `cashu_proofs`) to the domain {@link Account};
 * here that mapping is framework-free and the LIVE wallet handle / decrypted proofs are
 * resolved through the injected {@link AccountHandleResolver} (deferred to Slice 3 — see
 * `account-handle-resolver.ts`).
 *
 * This module owns:
 *  - {@link AgicashDbAccount} / {@link AgicashDbCashuProof} / {@link AgicashDbAccountWithProofs}
 *    — the row shapes (master: generated `supabase/database.types.ts`). Hand-written here as
 *    in `db-user.ts`, so the SDK can type the otherwise-untyped Supabase reads without
 *    pulling the full generated `Database` types (lifted in a later slice).
 *  - {@link CashuAccountDetailsDbDataSchema} / {@link SparkAccountDetailsDbDataSchema} — the
 *    `details` JSON schemas (lifted verbatim from `json-models/*-account-details-db-data.ts`).
 *  - {@link isCashuAccount} / {@link isSparkAccount} — the type guards (verbatim).
 *  - {@link dbAccountToAccount} — the row→domain mapper (verbatim logic from
 *    `account-repository.toAccount`, minus the live-handle/decrypt construction which the
 *    resolver owns).
 *
 * @module
 */
import { z } from 'zod/mini';
import type {
  Account,
  AccountPurpose,
  AccountState,
  AccountType,
  SparkNetwork,
} from '../types/account';
import type { Currency } from '../types/money';
import type {
  AccountHandleResolver,
  EncryptedCashuProofRow,
} from './account-handle-resolver';

// --- json-model `details` schemas (verbatim from json-models/*-account-details-db-data) --

/** The `accounts.details` JSON for a cashu account (verbatim from master). */
export const CashuAccountDetailsDbDataSchema = z.object({
  /** URL of the mint. */
  mint_url: z.string(),
  /** Whether the mint is a test mint. */
  is_test_mint: z.boolean(),
  /** Counter value per mint keyset (keysetId → counter). */
  keyset_counters: z.record(z.string(), z.number()),
});
/** `z.infer` of {@link CashuAccountDetailsDbDataSchema}. */
export type CashuAccountDetailsDbData = z.infer<
  typeof CashuAccountDetailsDbDataSchema
>;

/** The `accounts.details` JSON for a spark account (verbatim from master). */
export const SparkAccountDetailsDbDataSchema = z.object({
  /** Network of the Spark account (stored uppercase). */
  network: z.enum(['MAINNET', 'REGTEST']),
});
/** `z.infer` of {@link SparkAccountDetailsDbDataSchema}. */
export type SparkAccountDetailsDbData = z.infer<
  typeof SparkAccountDetailsDbDataSchema
>;

// --- row shapes (hand-written; master = generated supabase/database.types.ts) ------------

/**
 * A row of the `wallet.accounts` table.
 *
 * Lifted from master `agicash-db/database.ts#AgicashDbAccount`
 * (`Database['wallet']['Tables']['accounts']['Row']`, generated in
 * `supabase/database.types.ts`). Hand-written here (as in {@link AgicashDbUser}) so the SDK
 * can narrow the currently-untyped Supabase reads; replaced by the generated types when
 * those are lifted into the package. `details` is the per-type JSON parsed by the guards.
 */
export type AgicashDbAccount = {
  /** UUID primary key. */
  id: string;
  /** Display name. */
  name: string;
  /** `'cashu' | 'spark'`. */
  type: AccountType;
  /** What the account is for. */
  purpose: AccountPurpose;
  /** `'active' | 'expired'`. */
  state: AccountState;
  /** The account currency. */
  currency: Currency;
  /** Per-type JSON blob (cashu mint/keyset info, or spark network). */
  details: unknown;
  /** Row creation time, ISO 8601. */
  created_at: string;
  /** Account expiry, ISO 8601, or null for non-expiring. */
  expires_at: string | null;
  /** Owning user id. */
  user_id: string;
  /** Row version (optimistic lock). */
  version: number;
};

/**
 * A row of the `wallet.cashu_proofs` table.
 *
 * Lifted from master `agicash-db/database.ts#AgicashDbCashuProof`. NOTE: `amount` + `secret`
 * are ENCRYPTED ciphertext on the row (typed `string`); decryption to a `number` / plaintext
 * `string` happens in the {@link AccountHandleResolver} (Slice 3). Only the encrypted
 * columns the mapper forwards are typed; the spend-tracking foreign-key columns are omitted
 * (not needed by the read mapper).
 */
export type AgicashDbCashuProof = {
  id: string;
  account_id: string;
  user_id: string;
  keyset_id: string;
  /** Encrypted ciphertext. */
  amount: string;
  /** Encrypted ciphertext. */
  secret: string;
  unblinded_signature: string;
  public_key_y: string;
  dleq: unknown;
  witness: unknown;
  state: 'UNSPENT' | 'RESERVED' | 'SPENT';
  version: number;
  created_at: string;
  reserved_at: string | null;
  spent_at?: string | null;
};

/**
 * An account row joined with its `cashu_proofs`. For a spark account `cashu_proofs` is an
 * empty array (verbatim from master `AgicashDbAccountWithProofs`).
 */
export type AgicashDbAccountWithProofs = AgicashDbAccount & {
  cashu_proofs: AgicashDbCashuProof[];
};

// --- type guards (verbatim from agicash-db/database.ts) ----------------------------------

/**
 * Whether the row is a cashu account (verbatim from master `isCashuAccount`).
 * @throws if `type === 'cashu'` but `details` fails the cashu schema.
 */
export function isCashuAccount(
  data: AgicashDbAccount,
): data is AgicashDbAccount & {
  type: 'cashu';
  details: CashuAccountDetailsDbData;
} {
  if (data.type !== 'cashu') {
    return false;
  }
  CashuAccountDetailsDbDataSchema.parse(data.details);
  return true;
}

/**
 * Whether the row is a spark account (verbatim from master `isSparkAccount`).
 * @throws if `type === 'spark'` but `details` fails the spark schema.
 */
export function isSparkAccount(
  data: AgicashDbAccount,
): data is AgicashDbAccount & {
  type: 'spark';
  details: SparkAccountDetailsDbData;
} {
  if (data.type !== 'spark') {
    return false;
  }
  SparkAccountDetailsDbDataSchema.parse(data.details);
  return true;
}

/** Map the encrypted cashu-proof rows to the resolver's {@link EncryptedCashuProofRow} input. */
function toEncryptedProofRows(
  proofs: AgicashDbCashuProof[],
): EncryptedCashuProofRow[] {
  return proofs.map((p) => ({
    id: p.id,
    accountId: p.account_id,
    userId: p.user_id,
    keysetId: p.keyset_id,
    amount: p.amount,
    secret: p.secret,
    unblindedSignature: p.unblinded_signature,
    publicKeyY: p.public_key_y,
    // dleq/witness are cashu-ts `Proof` sub-fields; the domain `CashuProof` carries them
    // as-is (Slice 3's resolver re-parses via cashu-ts `ProofSchema`). Cast to the domain
    // sub-field type (a placeholder until cashu-ts types are imported).
    dleq: p.dleq as EncryptedCashuProofRow['dleq'],
    witness: p.witness as EncryptedCashuProofRow['witness'],
    state: p.state,
    version: p.version,
    createdAt: p.created_at,
    reservedAt: p.reserved_at,
    spentAt: p.spent_at,
  }));
}

/**
 * Map a `wallet.accounts` row (joined with `cashu_proofs`) to the domain {@link Account}.
 *
 * Verbatim logic from master `account-repository.toAccount`: the common base fields are
 * copied straight off the row; the per-type fields are read from the parsed `details`; and
 * the connection-bound fields — the live `wallet` handle, `isOnline`, decrypted cashu
 * `proofs` / spark `balance` — come from the injected {@link AccountHandleResolver} (the
 * Slice-2 deferral stub or the Slice-3 real resolver).
 *
 * @param data - the joined account row.
 * @param resolver - fills in the deferred live-handle fields.
 * @returns the domain account.
 * @throws Error if the row's `type` is neither cashu nor spark.
 */
export async function dbAccountToAccount<T extends Account = Account>(
  data: AgicashDbAccountWithProofs,
  resolver: AccountHandleResolver,
): Promise<T> {
  const commonData = {
    id: data.id,
    name: data.name,
    currency: data.currency,
    purpose: data.purpose,
    state: data.state,
    createdAt: data.created_at,
    version: data.version,
    expiresAt: data.expires_at,
  };

  if (isCashuAccount(data)) {
    const details = data.details;
    const { wallet, isOnline, proofs } = await resolver.resolveCashu({
      mintUrl: details.mint_url,
      currency: data.currency,
      encryptedProofs: toEncryptedProofRows(data.cashu_proofs),
    });

    return {
      ...commonData,
      isOnline,
      type: 'cashu',
      mintUrl: details.mint_url,
      isTestMint: details.is_test_mint,
      keysetCounters: details.keyset_counters,
      proofs,
      wallet,
    } as T;
  }

  if (isSparkAccount(data)) {
    const network: SparkNetwork = data.details.network;
    const { wallet, isOnline, balance } = await resolver.resolveSpark({
      network,
    });

    return {
      ...commonData,
      type: 'spark',
      balance,
      network,
      isOnline,
      wallet,
    } as T;
  }

  throw new Error('Invalid account type');
}
