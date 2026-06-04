/**
 * SDK-internal spark quote **runtime schemas** — Slice 3 / PR5c (spark send + receive).
 *
 * The spark send/receive repositories (PR5c) parse a decrypted DB row back to the domain type
 * with `SparkSendQuoteSchema.parse` / `SparkReceiveQuoteSchema.parse`, and parse the encrypted
 * `jsonb` blob with the `agicash-db/json-models` `*DbDataSchema` validators. The package's
 * `types/spark.ts` ships the matching `z.infer` TS types as the public surface; these are the
 * runtime validators behind them, lifted SINGLE-SOURCE so the shapes can never drift.
 *
 * Re-housing approach (matches `./lib-cashu-quotes`): re-export the single live source from the
 * SPECIFIC `apps/web-wallet/app/...` modules via a relative path so there is exactly ONE
 * implementation (no duplication, no web churn). We import from the specific quote-schema +
 * json-model files (NOT a barrel) so nothing heavier is pulled. None of these symbols
 * transitively pulls react / @tanstack / the native Breez WASM (verified): the master
 * spark-quote-schema + spark-lightning json-model files are pure `zod/mini` + `Money`
 * (`SparkReceiveQuoteSchema` additionally pulls the cashu `CashuTokenMeltDataSchema`, also
 * pure zod/mini). The `~/*` path alias (mapped in the package `tsconfig.json`) lets the
 * re-exported schema files resolve their own `~/lib/money` imports — the same single-source
 * seam PR5b's `lib-cashu-quotes` uses. The canonical relocation of these schema files INTO the
 * package is a deferred follow-up (out of the build-plan's scope).
 *
 * @module
 */

// --- runtime domain schemas (send/receive spark-*-quote.ts) ------------------------------
export { SparkSendQuoteSchema } from '../../../../apps/web-wallet/app/features/send/spark-send-quote';
export { SparkReceiveQuoteSchema } from '../../../../apps/web-wallet/app/features/receive/spark-receive-quote';

// --- encrypted-jsonb DB-data schemas (agicash-db/json-models) ----------------------------
export {
  SparkLightningSendDbDataSchema,
  SparkLightningReceiveDbDataSchema,
} from '../../../../apps/web-wallet/app/features/agicash-db/json-models';
