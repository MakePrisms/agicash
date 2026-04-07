---
name: Breez SDK Migration
description: Replacing @buildonspark/spark-sdk with @breeztech/breez-sdk-spark — prototype validation in progress, key derivation compatibility confirmed
type: project
---

Migrating from `@buildonspark/spark-sdk@0.7.4` to `@breeztech/breez-sdk-spark@0.12.2` due to mobile reliability issues (stuck balances, unreliable events, optimization visibility).

**Why:** Current SDK has persistent bugs on mobile — balance doesn't update after transactions, balance drops to zero, balance jumps during optimization, slow init, unreliable events forced polling.

**How to apply:** Phase C (prototype validation) → Phase A (production replacement). C1 key derivation match confirmed 2026-04-04. Remaining C-steps: balance reliability, events, optimization, fees, init perf, error catalog.

**Integration pattern:** Import from root `@breeztech/breez-sdk-spark` (not `/bundler`). WASM init in `entry.client.tsx`. All app code uses dynamic `import()` to avoid SSR module graph issues. Exclude from Vite `optimizeDeps`.

**Open question:** Lightning Address delegated invoices (`receiverIdentityPubkey`) — user clarifying with Breez.

**Breez API key:** User has one. Env var: `VITE_BREEZ_API_KEY`.

**Spec:** `docs/superpowers/specs/2026-04-04-breez-spark-sdk-migration-design.md`
**Plan:** `docs/superpowers/plans/2026-04-04-breez-spark-sdk-prototype-validation.md`
**Results:** `docs/superpowers/specs/2026-04-04-breez-spark-sdk-validation-results.md`
**Branch:** `prototype/breez-spark-sdk-validation`
