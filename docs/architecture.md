# Architecture

The agicash workspace is laid out as a pure-Rust core that compiles to four
deliverables: a CLI binary, an iOS XCFramework, an Android JNI library, and a
browser-side wasm bundle (the Leptos PWA). Every shell binds to the same
public surface — `agicash_wallet::WalletClient` — and the same trait-defined
seams for storage, identity, and time. This document walks the layers from the
view down to the backends.

## Layers

```
View              SwiftUI · Compose · Leptos · clap
ViewModel         per-platform (Swift/Kotlin/Leptos signals/CLI command fn)
Facade            agicash-wallet::WalletClient
Orchestrators     agicash-services::{cashu, spark, lightning_address, ...}
State machines    agicash-cashu, agicash-spark      (sans-IO)
Seams             agicash-traits                    (Storage*, KeyProvider, ...)
Impls             agicash-storage-supabase · agicash-auth-opensecret · cdk
Backends          OpenSecret · Supabase · Cashu mints · Lightning · Breez Spark
```

## Components

### Core crates (foundation)

- `agicash-domain` — primitive value types: ids, currency, account, transaction,
  protocol-agnostic.
- `agicash-money` — currency- and unit-safe arithmetic. Raw integer math is a
  bug; every cross-crate boundary takes `Money`.
- `agicash-crypto` — `xchacha20poly1305` symmetric encryption + the per-user
  key derivation used by the storage layer.

### Trait seams

`agicash-traits` is the single home for the workspace's seams. Notable traits:

- `Storage*` — one trait per aggregate (accounts, send swaps, receive swaps,
  proofs, users, ...). Each `Storage*` is async + send and is implemented
  multiple times: real (`agicash-storage-supabase`) and fake (`agicash-testing`).
- `KeyProvider` — fetches the user's encryption key. Real impl talks to
  OpenSecret; fake impl returns a deterministic key.
- `TokenProvider` — fetches the OpenSecret session token / Supabase JWT used
  by the storage HTTP client.
- `Clock` — monotonic time. Production impl is `std::time`; tests inject a
  fake.

The traits are intentionally narrow so the wasm shell can supply
`?Send` variants for browser-side use without bleeding `Send + Sync`
bounds into the higher layers.

### Protocol crates (sans-IO state machines)

- `agicash-cashu` — wraps [`cdk`](https://github.com/cashubtc/cdk) and adds
  feature-specific state machines: send swap, receive swap, mint, melt,
  restore. Each state machine consumes input events (HTTP response, storage
  result, timer fire) and emits output events (HTTP request, storage write,
  timer set, user-facing status). No async, no I/O. Tests pump events.
- `agicash-spark` — same shape for the Lightning side, wrapping a fork of
  the Breez SDK Spark client.

### Service crates (async orchestrators)

`agicash-services` glues the sans-IO state machines to concrete provider
impls. One orchestrator per feature (`CashuReceiveOrchestrator`,
`CashuSendOrchestrator`, `LightningAddressOrchestrator`, ...). The
orchestrator owns the async runtime; it drives the state machine to
completion by handling each output event.

Auxiliary services:

- `agicash-cache` — `WalletCache` + event bus + subscription primitives for
  in-process change notification.
- `agicash-exchange-rate` — FX provider trait + impl.
- `agicash-lightning-address` — LNURL-pay + LN-Address resolver.

### Facade

`agicash-wallet::WalletClient` aggregates every orchestrator behind one
struct. Every shell consumes `WalletClient` and nothing below it. New shell
features should land as `WalletClient` methods, not as new public types
deeper in the stack.

### Shells

- `agicash-cli` — `agicash` binary. clap commands map 1:1 to `WalletClient`
  methods. Session storage is pluggable (in-memory by default, OS keyring
  behind the `keyring-storage` feature).
- `agicash-ffi` — UniFFI surface. Re-exports `WalletClient` and its arg/return
  types as UniFFI-compatible shapes. Consumed by:
  - `bindings/swift/` — generates the iOS XCFramework + Swift sources.
  - `bindings/kotlin/` — generates per-ABI `.so` + Kotlin sources.
- `agicash-web-leptos` — Leptos PWA. Hydrate-only wasm bundle (CSR; no SSR,
  no server runtime). Calls `WalletClient` directly from the browser.
- `agicash-wasm` — separate wasm-bindgen shim for future non-Leptos browser
  consumers.

## External backends

- **OpenSecret enclave** — owns the user's BIP39 seed, derives encryption
  keys + Cashu/Spark wallet keys, issues third-party JWTs that Supabase
  trusts. The client authenticates with OpenSecret first; everything else is
  downstream of that session.
- **Supabase Postgres** — holds wallet rows (accounts, proofs, swaps,
  transactions) under the `wallet` schema. RLS ensures a user can only read
  their own rows. Sensitive columns are encrypted client-side with the key
  from OpenSecret, so the database operator can't decrypt user data even with
  full row access.
- **Cashu mints** — the `cdk` HTTP client talks to mints directly from the
  client. The mint sees blinded outputs only.
- **Lightning** — via the Spark client. The Lightning Service Provider
  endpoint and the user's Lightning seed are managed inside OpenSecret.

## Why trait composition

The whole architecture is a stack of small async trait objects. The same
`WalletClient` runs on every platform because every layer is parameterised on
its dependencies. Swapping a real provider for a fake in tests, or for an
alternate impl in a different deployment, is a constructor change at the
composition root — `agicash-cli/src/composition.rs` for the CLI,
`agicash-ffi/src/wallet.rs` for the mobile FFI, the Leptos `App` setup for
the PWA. No business logic moves.

For the slice-by-slice design history, see
[`superpowers/specs/2026-05-14-agicash-rust-sdk-design.md`](superpowers/specs/2026-05-14-agicash-rust-sdk-design.md).
