# Surface-break acceptance bar for slice plans

**Date:** 2026-05-15
**Status:** accepted
**Scope:** any slice in the rust workspace (`crates/`) that changes a CLI subcommand, public crate API, FFI shape, trait surface, or DTO/feature flag

## The rule

> Any slice that changes the CLI or FFI surface MUST run
> `cargo test --workspace` AND `cargo check --workspace --all-targets --all-features`
> green as a numbered acceptance criterion on its slice plan.
> Not just `cargo test -p <slice-crate>`. The whole workspace.

This applies before the slice is merged into its `feat/rust-*` branch
and again before the branch is opened as a PR.

## Why

Twice in one day (2026-05-15) a slice changed the CLI surface and broke
pre-existing integration tests silently:

- **Slice 7** split `agicash receive` into `receive token` + `receive lightning`.
  The pre-existing `receive.rs` integration test (gated behind
  `real-mint-tests,real-supabase-tests,real-opensecret-tests`) still
  invoked the old shape and broke at compile time — but only when those
  features were enabled. No CI ran with those features. The break was
  caught hours later by a separate audit.

- **Slice 8** split `agicash send` into `send token` + `send lightning`
  and broke the equivalent `send.rs` test the same way.

Per-crate `cargo test -p agicash-cli` from inside the slice never
triggered the rot because the slice author was working on a different
crate. Per-crate `cargo test -p agicash-storage-supabase` from another
slice never triggered it either. Each crate is green; the workspace
isn't. That gap is exactly what `--workspace` plus `--all-features`
closes.

The friction is structural, not a discipline failure:
agents complete slices, see green tests in their own crate, declare
done, and never run the wider gate. The CI gate enforces it
automatically so no one has to remember.

## How

### CI (automatic)

`.github/workflows/rust.yml` has a `workspace-surface-gate` job that:

1. Triggers on `push` to any branch matching `feat/rust-*`
2. Runs `cargo test --workspace` (executes all non-gated tests)
3. Runs `cargo check --workspace --all-targets --all-features`
   (compiles the network-gated `real-*` integration tests so any
   surface drift fails the build rather than silently no-op'ing under
   `cfg(feature = "real-...")`)

A red gate blocks the slice from being considered done.

### Slice plans (manual checklist)

Every slice plan under `docs/rust/slices/` MUST add the following lines
to its acceptance bar:

```markdown
- [ ] `cargo test --workspace` green from `crates/`
- [ ] `cargo check --workspace --all-targets --all-features` green from `crates/`
```

If either is red, the slice is not done — even if the slice's own
crate is green and the feature works locally.

## What this does NOT catch

- **Real-network behavioral regressions.** The gate compiles the
  `real-*` tests but does not execute them. Wire-format breaks against
  testnut, supabase, or opensecret still need a separate lane (local
  docker-compose stack) which is not yet in CI.
- **Runtime panics gated behind feature flags.** If a gated test
  compiles but panics on a real network call, only a real-network lane
  will catch it.
- **TypeScript / JS surface breaks.** This rule is rust-workspace
  scoped. The TS side has its own `ci.yml` checks.

These are separate problems with separate fixes. The point of this
rule is to close the silent-rot loop at slice-merge time so the audit
delay (hours) collapses to CI feedback (minutes).

## References

- CI workflow: `.github/workflows/rust.yml` — `workspace-surface-gate` job
- Slice 7: `docs/rust/slices/2026-05-14-slice-7-cashu-lightning-receive.md`
- Slice 8: `docs/rust/slices/2026-05-15-slice-8-cashu-lightning-send.md`
- Related spec: `2026-05-14-agicash-rust-sdk-design.md`
