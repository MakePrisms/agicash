/**
 * SDK-internal cashu quote/swap **runtime schemas + service primitives** — Slice 3 / PR5b.
 *
 * The cashu send/receive SERVICES (PR5b) need three groups of `app/lib/cashu` + `app/features`
 * symbols beyond the Slice-2/PR5a balance + wallet-construction helpers (`./lib-cashu` /
 * `./lib-cashu-wallet`):
 *
 *  1. the runtime zod SCHEMAS for the quote/swap domain types — the repos parse a decrypted
 *     DB row back to the domain type with `CashuSendQuoteSchema.parse` etc. (the package's
 *     `types/cashu.ts` ships the matching `z.infer` TS types as the public surface; these are
 *     the runtime validators behind them, lifted single-source so the shapes can never drift);
 *  2. the `agicash-db/json-models` `*DbDataSchema` validators for the encrypted `jsonb` blobs;
 *  3. small framework-free cashu protocol helpers (`proofToY` / `sumProofs` / `splitAmount` /
 *     `getCashuProtocolUnit` / `areMintUrlsEqual`) + `toProof` / `CashuProofSchema`.
 *
 * Re-housing approach (matches `./lib-cashu` / `./lib-cashu-wallet` / `types/money.ts`):
 * re-export the SINGLE live source from the specific `apps/web-wallet/app/...` modules via a
 * relative path so there is exactly ONE implementation (no duplication, no web churn). We
 * import from the SPECIFIC modules (NOT the `lib/cashu` barrel) so we do NOT pull the heavier
 * `melt-quote-subscription-manager` / `mint-quote-subscription-manager` surface the barrel
 * re-exports — those mint-WS managers are the orchestrator sub-slice (5d), not PR5b. None of
 * the symbols re-exported here transitively pulls react / @tanstack (verified): the master
 * domain-schema + json-model files are pure `zod/mini` + `Money` + `@cashu/cashu-ts`.
 *
 * The `~/*` path alias (mapped in the package `tsconfig.json` to `apps/web-wallet/app/*`) lets
 * the re-exported schema files resolve their own `~/lib/money` / `~/lib/cashu` imports — the
 * same single-source seam, one level deeper than PR5a's leaf-only re-exports. `send/utils.ts`'s
 * `toDecryptedCashuProofs` is the one helper NOT re-exported (it imports a `database.ts` DB-row
 * type that pulls the generated `supabase/database.types`, not in the package's resolution); it
 * is re-housed locally below (a tiny pure mapper) — matching `db-account.ts`'s hand-written DB
 * rows. The canonical relocation of `app/lib/cashu/**` + these schema files INTO the package is
 * a deferred follow-up (out of the build-plan's scope).
 *
 * @module
 */
import type { Token } from '@cashu/cashu-ts';
import { z } from 'zod/mini';
import type { AgicashDbCashuProof } from './db-account';
import { ProofSchema } from './lib-cashu-wallet';
import { computeSHA256 } from './crypto';
import { encodeToken } from '../../../../apps/web-wallet/app/lib/cashu/token';
import { sumProofs } from '../../../../apps/web-wallet/app/lib/cashu/proof';
import type { CashuProof } from '../types/account';
import { type Currency, type CurrencyUnit, Money } from '../types/money';

// --- cashu protocol helpers (specific modules; framework-free) ---------------------------
export { proofToY } from '../../../../apps/web-wallet/app/lib/cashu/proof';
export {
  areMintUrlsEqual,
  getCashuProtocolUnit,
  getCashuUnit,
} from '../../../../apps/web-wallet/app/lib/cashu/utils';
export { encodeToken } from '../../../../apps/web-wallet/app/lib/cashu/token';
export { splitAmount } from '@cashu/cashu-ts';
export { sumProofs };

// --- domain CashuProof helpers (accounts/cashu-account.ts) --------------------------------
export {
  CashuProofSchema,
  toProof,
} from '../../../../apps/web-wallet/app/features/accounts/cashu-account';

// --- runtime domain schemas (send/receive *-quote.ts + *-swap.ts) ------------------------
export {
  CashuSendQuoteSchema,
  DestinationDetailsSchema,
} from '../../../../apps/web-wallet/app/features/send/cashu-send-quote';
export { CashuSendSwapSchema } from '../../../../apps/web-wallet/app/features/send/cashu-send-swap';
export { CashuReceiveQuoteSchema } from '../../../../apps/web-wallet/app/features/receive/cashu-receive-quote';
export { CashuReceiveSwapSchema } from '../../../../apps/web-wallet/app/features/receive/cashu-receive-swap';

// --- encrypted-jsonb DB-data schemas (agicash-db/json-models) ----------------------------
export {
  CashuLightningSendDbDataSchema,
  CashuSwapSendDbDataSchema,
  CashuLightningReceiveDbDataSchema,
  CashuSwapReceiveDbDataSchema,
} from '../../../../apps/web-wallet/app/features/agicash-db/json-models';

/**
 * Map encrypted cashu-proof rows + their interleaved decrypted `(amount, secret)` plaintexts
 * to domain {@link CashuProof}s. Re-housed verbatim from master `send/utils.ts#toDecryptedCashuProofs`
 * (the SDK uses its own hand-written {@link AgicashDbCashuProof} row instead of master's
 * `database.ts` generated one — same fields, so the logic is identical).
 *
 * @param proofs - the encrypted proof rows.
 * @param decryptedProofsData - the interleaved decrypted `[amount, secret, amount, secret, …]`.
 * @returns the domain proofs (amount re-parsed as a `number`, secret as a `string`).
 */
export function toDecryptedCashuProofs(
  proofs: AgicashDbCashuProof[],
  decryptedProofsData: unknown[],
): CashuProof[] {
  return proofs.map((dbProof, index) => {
    const decryptedDataIndex = index * 2;
    const amount = z.number().parse(decryptedProofsData[decryptedDataIndex]);
    const secret = z
      .string()
      .parse(decryptedProofsData[decryptedDataIndex + 1]);

    return {
      id: dbProof.id,
      accountId: dbProof.account_id,
      userId: dbProof.user_id,
      keysetId: dbProof.keyset_id,
      amount,
      secret,
      unblindedSignature: dbProof.unblinded_signature,
      publicKeyY: dbProof.public_key_y,
      dleq: ProofSchema.shape.dleq.parse(dbProof.dleq),
      witness: ProofSchema.shape.witness.parse(dbProof.witness),
      state: dbProof.state,
      version: dbProof.version,
      createdAt: dbProof.created_at,
      reservedAt: dbProof.reserved_at,
    };
  });
}

/**
 * The SHA-256 hash of a cashu token (its canonical encoded form). Re-housed VERBATIM from
 * `shared/cashu.ts#getTokenHash` (master's lives next to react-coupled query options, so it is
 * re-housed here rather than re-exported). Used to de-dupe receive swaps + tag send swaps.
 *
 * @param token - a decoded {@link Token} (encoded first) or an already-encoded token string.
 * @returns the hex SHA-256 hash.
 */
export function getTokenHash(token: Token | string): Promise<string> {
  if (typeof token === 'string') {
    return computeSHA256(token);
  }
  return computeSHA256(encodeToken(token));
}

/** Map a token's `unit` to the domain `Currency` + cashu `CurrencyUnit` (master verbatim). */
function getCurrencyAndUnitFromToken(token: Token): {
  currency: Currency;
  unit: CurrencyUnit;
} {
  if (token.unit === 'sat') {
    return { currency: 'BTC', unit: 'sat' };
  }
  if (token.unit === 'usd') {
    return { currency: 'USD', unit: 'cent' };
  }
  throw new Error(`Invalid token unit ${token.unit}`);
}

/**
 * The {@link Money} value of a cashu token (sum of its proofs in the token's unit). Re-housed
 * VERBATIM from `shared/cashu.ts#tokenToMoney`.
 *
 * @param token - the decoded token.
 * @returns the token amount as {@link Money}.
 */
export function tokenToMoney(token: Token): Money {
  const { currency, unit } = getCurrencyAndUnitFromToken(token);
  return new Money<Currency>({
    amount: sumProofs(token.proofs),
    currency,
    unit,
  });
}
