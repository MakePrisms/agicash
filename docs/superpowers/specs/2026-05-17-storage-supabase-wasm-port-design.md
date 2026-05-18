# `agicash-storage-supabase` — wasm32 port

**Date:** 2026-05-17
**Status:** Open — follow-up to `2026-05-17-leptos-email-and-balance-design.md`.

## Goal

Make `agicash-storage-supabase` compile and run on `wasm32-unknown-unknown`
so the Leptos PWA can replace its direct `gloo-net` Supabase REST calls
(see `crates/agicash-web-leptos/src/components/wallet_context.rs`) with
the same typed `SupabaseStorage` the iOS / Android / CLI binaries use.

End-state: one storage surface, all four platforms exercise it.

## Why this is multi-day

Three classes of issues stack:

### 1. TLS layer (rustls + ring)

`SupabaseStorage::http_client()` (in `client.rs`) builds a reqwest
client wired against `rustls-platform-verifier`:

```rust
rustls::crypto::ring::default_provider().install_default();
let tls_config = rustls::ClientConfig::with_platform_verifier()?;
reqwest::Client::builder()
    .use_preconfigured_tls(tls_config)
    .connect_timeout(...)
    .build()
```

On wasm32 there is no native TLS — the browser handles it inside `fetch`.
`rustls`, `ring`, and `rustls-platform-verifier` do not compile.

**Fix:** target-gate `http_client()`. On wasm32, just
`reqwest::Client::new()` (the wasm reqwest backend uses browser fetch).
The `use_preconfigured_tls` + timeout setters are skipped — browsers
have their own timeout policy.

### 2. Reqwest feature flags

`reqwest` is workspace-pinned as:

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
```

The `rustls-tls` feature pulls native rustls + ring even on wasm32.

**Fix:** override per-target in `agicash-storage-supabase/Cargo.toml`:

```toml
[target.'cfg(not(target_arch = "wasm32"))'.dependencies]
reqwest = { workspace = true }
rustls = { workspace = true }
rustls-platform-verifier = { workspace = true }

[target.'cfg(target_arch = "wasm32")'.dependencies]
reqwest = { version = "0.12", default-features = false, features = ["json"] }
```

This needs to thread to the `postgrest` patch (the `gudnuf/postgrest-rs`
fork at `branch = "feat/reqwest-0.12-tls-injection"`) — it also gates
TLS features inside the patched crate, which may need its own
wasm-aware feature split.

### 3. Tokio runtime + mio

The workspace pin pulls `tokio` with `["macros", "rt-multi-thread", "signal", "sync", "time"]`.
On wasm32:

- `rt-multi-thread` and `signal` pull `mio`, which fails:
  ```
  error: This wasm target is unsupported by mio.
         If using Tokio, disable the net feature.
  ```
- `tokio::sync::OnceCell` and `tokio::sync::RwLock` (used by
  `OpenSecretClient` and `AgicashWallet`) need only the `sync`
  feature, which IS wasm-clean.

**Fix:** target-gate the tokio dep too:

```toml
[target.'cfg(target_arch = "wasm32")'.dependencies]
tokio = { version = "1.42", default-features = false, features = ["sync", "macros"] }
```

This affects every workspace crate that pulls tokio transitively — at
minimum `agicash-storage-supabase`, `agicash-cashu`, `agicash-traits`,
`agicash-auth-opensecret`. Worth auditing the `Cargo.toml` of each.

### 4. `?Send` trait gates (already partially done)

`audit/auth-opensecret-wasm` introduced the `FooBounds` trait-alias
pattern + `cfg_attr(target_arch = "wasm32", async_trait(?Send))` for
`TokenProvider` and `KeyProvider`. The same pattern is needed for:

- `UserStorage` (`agicash-traits/src/user_storage.rs`)
- `CashuReceiveSwapStorage`, `CashuSendSwapStorage`,
  `CashuMintQuoteStorage`, `CashuMeltQuoteStorage` (in `agicash-cashu`)
- `ProofEncryption`
- `CashuProvider`

And the impls in `agicash-storage-supabase/src/*_storage.rs` need
matching `cfg_attr` on their `#[async_trait]` macros.

The `Arc<dyn Storage + Send + Sync>` slots in `agicash-ffi::wallet`
also need a target-gated bound — `Arc<dyn Storage>` on wasm,
`Arc<dyn Storage + Send + Sync>` on native.

## Order of operations

1. **`agicash-cashu` clippy + tokio audit.** Same `target_arch` gating
   pattern as above. This is the deepest dep — fixing it last works
   too, but you'll get clearer errors if it's done first.
2. **`agicash-traits` `?Send` gates** on all the Storage traits.
   Mirror the `TokenProvider` change exactly (`FooBounds` marker
   + `cfg_attr` `async_trait`).
3. **`agicash-storage-supabase` Cargo.toml** target-gated reqwest/rustls
   deps + the `http_client()` split.
4. **`agicash-storage-supabase` impl files** — `cfg_attr` the
   `#[async_trait]` macros to match the trait changes.
5. **Bring up wasm compile:**
   `nix develop .#wasm -c cargo check -p agicash-storage-supabase --target wasm32-unknown-unknown`.
6. **Update `agicash-web-leptos`:** add `agicash-storage-supabase` and
   `agicash-traits` to the wasm32-only dep section, swap
   `wallet_context::fetch_accounts_via_rest` for
   `SupabaseStorage::list_accounts`.

## Estimated scope

- 1 worker-day for the rustls/ring/reqwest swap if it's clean.
- 1 worker-day for the `?Send` audit if `audit/auth-opensecret-wasm`'s
  pattern transplants cleanly.
- 0.5 worker-day for the `tokio` feature audit + verification.
- 0.5 worker-day for the leptos integration.

Likely 2.5–3 worker-days in practice given debug cycles on the patched
postgrest fork.

## Out of scope for this spec

- Per-account balance sums (needs `CashuSendSwapStorage` wasm port too,
  which is essentially the same work for the Cashu crate).
- Realtime websocket subscriptions (Supabase realtime). That's another
  follow-up lane on top of this one.
- A `WalletClient` facade in `agicash-wallet`. Today every consumer
  wires deps directly; lifting that into a facade is a separate
  refactor.
