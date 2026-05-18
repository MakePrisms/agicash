# Testing

## Layout

Rust unit + integration tests live next to the code they test. The full
workspace test run is:

```sh
atest          # = cargo test --workspace
```

Sans-IO state machines (`agicash-cashu`, `agicash-spark`) are exhaustively
covered by event-pump tests; they take input events and assert on output
events, with no async runtime involved. Service-layer crates
(`agicash-services`) test the orchestrators with in-memory fakes from
`agicash-testing` substituted for the real `Storage*` + provider impls.

## Real-service integration tests

Tests that hit live services are feature-gated so they never run in the
default `cargo test --workspace` pass:

- `agicash-cli` — `real-opensecret-tests`, `real-supabase-tests`,
  `real-mint-tests`.
- `agicash-storage-supabase` — similar feature flags.

Run an opted-in suite:

```sh
cargo test -p agicash-cli --features real-mint-tests -- --nocapture
```

These suites require the local stack: OpenSecret on `:3999`, Supabase on
`:54321`, and either a reachable testnet mint or `AGICASH_TEST_MINT_URL`
pointed at one you control.

## Platform tests

- iOS — `xcodebuild test -project ios/Agicash/Agicash.xcodeproj -scheme Agicash`.
  Regenerate the swift bindings first (`bindings/swift/generate-bindings.sh`).
- Android — `cd android/Agicash && ./gradlew test`. Regenerate the kotlin
  bindings first (`bindings/kotlin/generate-bindings.sh`).

## CI

GitHub Actions runs the rust workspace checks on every push (see
`.github/workflows/`). The pipeline runs `cargo fmt --check`, `cargo clippy
--workspace --all-targets -- -D warnings`, and `cargo test --workspace` in
parallel. Failures block merge to `master`.
