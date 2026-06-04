/**
 * SDK-internal transaction **runtime schemas + parser** single-source re-export — Slice 4.
 *
 * The transaction repository (`./transaction-repository`) parses a DB row → the domain
 * {@link Transaction} exactly as master does: decrypt the `encrypted_transaction_details`
 * jsonb, validate it with {@link TransactionDetailsDbDataSchema}, run the per-variant
 * {@link TransactionDetailsParser} (the 6 `z.pipe` parsers), then validate the assembled row
 * with {@link TransactionSchema}. Those runtime validators are LIFTED single-source from
 * `apps/web-wallet/app/features/transactions/**` via the `~/*` path alias (mapped in the
 * package `tsconfig.json` to `apps/web-wallet/app/*`), so there is exactly ONE implementation
 * and the public `z.infer` TS shapes in `types/transaction.ts` + `types/transaction-details.ts`
 * can never drift from them.
 *
 * Re-housing approach (matches `./lib-cashu-quotes`): re-export the SINGLE live source. The
 * whole `transaction.ts` → `transaction-details/*` → `transaction-enums.ts` chain is pure
 * `zod/mini` + `Money` + the `agicash-db/json-models` schemas (verified: no `react` /
 * `@tanstack/*` — the React-coupled `transaction-hooks.ts` / `transaction-details.tsx` /
 * `transaction-ack-status-store.ts` are NOT in this chain and are re-housed separately). The
 * `transaction-details-types.ts` `Json` import resolves to the shared `@agicash/db-types`
 * package (the generated Supabase types both the app and this SDK depend on).
 *
 * The DB-data union ({@link TransactionDetailsDbDataSchema}) + the per-variant parsers stay
 * SDK-INTERNAL (decision 7-ii: the SDK parses DB→domain inside; the DB-data shape is never
 * public). The public surface is only the domain `z.infer` types.
 *
 * The two account-capability gates ({@link canSendToLightning} / {@link canReceiveFromLightning})
 * are re-exported here too (they are the pure `accounts/account.ts` predicates the transfer
 * service gates on, §9) — single-source, same seam.
 *
 * @module
 */

// --- runtime transaction domain schemas (transactions/transaction.ts) --------------------
export {
  BaseTransactionSchema,
  TransactionSchema,
} from '../../../../apps/web-wallet/app/features/transactions/transaction';

// --- the internal DB-data union + the per-variant z.pipe parser (decision 7-ii) ----------
export {
  TransactionDetailsDbDataSchema,
  type TransactionDetailsParserInput,
} from '../../../../apps/web-wallet/app/features/transactions/transaction-details/transaction-details-types';
export { TransactionDetailsParser } from '../../../../apps/web-wallet/app/features/transactions/transaction-details/transaction-details-parser';

// --- account-capability gates (accounts/account.ts) — transfer leg validation (§9) -------
export {
  canReceiveFromLightning,
  canSendToLightning,
} from '../../../../apps/web-wallet/app/features/accounts/account';
