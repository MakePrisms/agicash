# Agicash Rust SDK

Rust core for the agicash wallet. Powers the CLI today, the web app via WASM
later, and future native shells.

See [the design spec](../docs/superpowers/specs/2026-05-14-agicash-rust-sdk-design.md)
for architecture, slicing, and rationale.

## Workspace layout

```
crates/
├── agicash-domain/             # foundational types: ids, currency, account, transaction
├── agicash-money/              # currency- and unit-safe arithmetic
├── agicash-crypto/             # xchacha20poly1305 + key derivation helpers (per slice)
├── agicash-traits/             # Storage*, KeyProvider, TokenProvider, providers, Clock
├── agicash-cashu/              # cdk wrapper + sans-IO state machines per feature
├── agicash-spark/              # Breez SDK Spark fork wrapper + state machines
├── agicash-storage-supabase/   # Storage trait impls over postgrest
├── agicash-auth-opensecret/    # KeyProvider + TokenProvider over opensecret 0.2.9
├── agicash-cache/              # WalletCache + event bus + subscription primitives
├── agicash-services/           # async orchestrators per feature
├── agicash-wallet/             # WalletClient facade — the public surface
├── agicash-cli/                # bin: clap + tokio + wallet
├── agicash-wasm/               # cdylib: wasm-bindgen wrappers
└── agicash-testing/            # in-memory fakes, fixtures, builders
```

## Common commands

From the repo root:

```bash
# build the whole workspace
cd crates && cargo build

# run all tests
cd crates && cargo test

# lint
cd crates && cargo clippy --workspace --all-targets -- -D warnings

# format
cd crates && cargo fmt --all

# build the WASM bundle for the web app
bun run wasm:build

# build CLI binary
cd crates && cargo build --release -p agicash-cli
# then ./crates/target/release/agicash --help
```

## Running the CLI

```bash
cd crates && cargo run -p agicash-cli -- --help
cd crates && cargo run -p agicash-cli -- version
```

Real subcommands (`auth login`, `balance`, `send`, etc.) ship in subsequent
slices — see `docs/superpowers/specs/2026-05-14-agicash-rust-sdk-design.md` §16.
