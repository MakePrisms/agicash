# Agicash Rust SDK — Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Open Secret SDK behind the `KeyProvider` / `TokenProvider` traits, persist `{user_id, refresh_token}` in the OS keyring, and expose CLI commands `agicash auth login | guest | logout | status`. After this slice, an integration test against the real Open Secret dev environment runs `agicash auth guest` in one process, then `agicash auth status` in a fresh process, and confirms the same user id appears — proving the persisted identity survives process restart. Slice-1 tests still pass.

**Architecture:** `agicash-crypto` gains the small key/algorithm/mnemonic types that the trait surfaces use. `agicash-traits` defines `KeyOptions`, `KeyProvider`, `TokenProvider`, a `SessionStorage` trait that stores a `PersistedSession { user_id, refresh_token }` blob, and `AuthError`. `agicash-auth-opensecret` implements those traits by wrapping a single shared `Arc<opensecret::Client>` with a `OnceCell` handshake guard and reading config from env vars; it also implements `SessionStorage` via the `keyring` crate (one entry stores a JSON blob). `agicash-cli` gets an `auth` subcommand tree and a tiny composition root that loads `.env` once, constructs the client + storage from env, and routes to per-subcommand handlers. The CLI binary calls `dotenvy::dotenv().ok()` at the very top of `main()`, so a developer who has `OPENSECRET_BASE_URL` and `OPENSECRET_CLIENT_ID` in `~/agicash/.env` doesn't need to export them. The lifecycle integration test is gated on a Cargo feature so plain `cargo test` stays hermetic.

**Tech Stack:** `opensecret = "0.2.9"` (crates.io), `keyring = "3"` for OS keychain access, `dotenvy = "0.15"` for loading `.env`, `zeroize = "1.8"` with the derive feature for secret-key drop semantics, `rpassword = "7"` for terminal password prompting, `bip39 = "2"` for mnemonic validation, `hex = "0.4"` for byte decoding, `parking_lot = "0.12"` (reserved for later but added to workspace now). All new types are `async-trait`-friendly. The CLI continues to use `clap` derive + `tokio`.

**Reference:** This plan implements slice 2 of `docs/superpowers/specs/2026-05-14-agicash-rust-sdk-design.md` (see §6, §10, §11, §12 "Open Secret test economy", §16). Slice-1 scaffold (`docs/superpowers/plans/2026-05-14-agicash-rust-scaffold.md`) is assumed complete and committed.

**Spec deviations:**
1. §10 lists `agicash auth … | whoami` as part of the v1 surface. **This plan drops `whoami`** — `auth status` carries the same load (reports session liveness AND the user id when active).
2. §6 defines `derive_public_key(options)` and `sign_message(message, options)` without an `algorithm` parameter. **This plan adds `algorithm: SigningAlgorithm`** to both because opensecret 0.2.9's underlying API requires it. The spec's signatures elide a required input.

Both deviations should be folded back into the spec when this slice is signed off.

**Branch:** Execute from `feat/rust-auth` in the worktree at `/Users/claude/agicash/.claude/worktrees/rust-auth`. Branched from `feat/rust-scaffold` (slice 1), which is itself off master.

---

## File Structure

```
crates/
├── Cargo.toml                                          # MODIFY — add workspace deps
├── agicash-crypto/
│   ├── Cargo.toml                                      # MODIFY — add deps
│   └── src/
│       ├── lib.rs                                      # MODIFY — wire new modules
│       ├── algorithm.rs                                # NEW — SigningAlgorithm
│       ├── secret_key.rs                               # NEW — SecretKey (zeroize)
│       ├── public_key.rs                               # NEW — PublicKey
│       ├── signature.rs                                # NEW — Signature
│       └── mnemonic.rs                                 # NEW — Mnemonic (BIP39)
├── agicash-traits/
│   ├── Cargo.toml                                      # MODIFY — add deps
│   └── src/
│       ├── lib.rs                                      # MODIFY — wire new modules
│       ├── error.rs                                    # NEW — AuthError
│       ├── key_options.rs                              # NEW — KeyOptions
│       ├── key_provider.rs                             # NEW — KeyProvider trait
│       ├── token_provider.rs                           # NEW — TokenProvider trait
│       └── session_storage.rs                          # NEW — SessionStorage trait + PersistedSession
├── agicash-auth-opensecret/
│   ├── Cargo.toml                                      # MODIFY — add deps + feature
│   └── src/
│       ├── lib.rs                                      # MODIFY — wire new modules
│       ├── config.rs                                   # NEW — OpenSecretConfig
│       ├── client.rs                                   # NEW — OpenSecretClient wrapper
│       ├── error.rs                                    # NEW — From<opensecret::Error> for AuthError
│       ├── session.rs                                  # NEW — login/register/guest/logout/refresh
│       ├── storage.rs                                  # NEW — KeyringSessionStorage
│       ├── key_provider.rs                             # NEW — OpenSecretKeyProvider
│       └── token_provider.rs                           # NEW — OpenSecretTokenProvider
└── agicash-cli/
    ├── Cargo.toml                                      # MODIFY — add deps + feature
    ├── src/
    │   ├── main.rs                                     # MODIFY — dotenvy + auth dispatch
    │   ├── cli.rs                                      # MODIFY — add Auth subcommand
    │   ├── composition.rs                              # NEW — build_auth_deps()
    │   └── auth.rs                                     # NEW — cmd_login/guest/logout/status
    └── tests/
        └── auth_lifecycle.rs                           # NEW — subprocess integration test
```

---

## Task 1: Workspace dependency additions

**Files:**
- Modify: `crates/Cargo.toml`

- [ ] **Step 1: Add the new workspace dependencies**

Open `crates/Cargo.toml`. In the `[workspace.dependencies]` table, add the following entries (preserve alphabetical-ish grouping by intent — auth deps grouped together):

```toml
# Auth / secrets / keyring / env
opensecret = "0.2.9"
keyring = "3"
zeroize = { version = "1.8", features = ["zeroize_derive"] }
rpassword = "7"
hex = "0.4"
bip39 = "2"
parking_lot = "0.12"
dotenvy = "0.15"
```

Place these near the existing `# Errors + misc` block. Do not change any other workspace section.

- [ ] **Step 2: Verify the workspace still resolves**

Run: `cd crates && cargo check --workspace`

Expected: PASS. The new deps are declared but not yet consumed by any crate; cargo only fetches them when a member crate references them, but a workspace-level `cargo check` must still succeed.

If the resolver fails (e.g., a transitive version conflict), stop and investigate before continuing — every later task assumes these are available.

- [ ] **Step 3: Commit**

```bash
git add crates/Cargo.toml
git commit -m "$(cat <<'EOF'
chore(rust): add workspace deps for slice 2 auth

opensecret 0.2.9, keyring 3, zeroize 1.8, rpassword 7, bip39 2, hex 0.4,
parking_lot 0.12, dotenvy 0.15.
EOF
)"
```

---

## Task 2: `agicash-crypto` — `SigningAlgorithm`

**Files:**
- Modify: `crates/agicash-crypto/Cargo.toml`
- Modify: `crates/agicash-crypto/src/lib.rs`
- Create: `crates/agicash-crypto/src/algorithm.rs`

- [ ] **Step 1: Add the `serde` dep to the crate**

Replace `crates/agicash-crypto/Cargo.toml`:

```toml
[package]
name = "agicash-crypto"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
serde = { workspace = true }
thiserror = { workspace = true }
zeroize = { workspace = true }
hex = { workspace = true }
bip39 = { workspace = true }

[dev-dependencies]
serde_json = { workspace = true }

[lints]
workspace = true
```

- [ ] **Step 2: Write the failing tests**

Create `crates/agicash-crypto/src/algorithm.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn algorithm_display_uses_lowercase() {
        assert_eq!(SigningAlgorithm::Schnorr.to_string(), "schnorr");
        assert_eq!(SigningAlgorithm::Ecdsa.to_string(), "ecdsa");
    }

    #[test]
    fn algorithm_parses_case_insensitively() {
        assert_eq!(
            "schnorr".parse::<SigningAlgorithm>().unwrap(),
            SigningAlgorithm::Schnorr
        );
        assert_eq!(
            "ECDSA".parse::<SigningAlgorithm>().unwrap(),
            SigningAlgorithm::Ecdsa
        );
    }

    #[test]
    fn algorithm_parse_rejects_unknown() {
        assert!("ed25519".parse::<SigningAlgorithm>().is_err());
        assert!("".parse::<SigningAlgorithm>().is_err());
    }

    #[test]
    fn algorithm_serializes_as_lowercase() {
        let json = serde_json::to_string(&SigningAlgorithm::Schnorr).unwrap();
        assert_eq!(json, "\"schnorr\"");
    }

    #[test]
    fn algorithm_deserializes_from_lowercase() {
        let a: SigningAlgorithm = serde_json::from_str("\"ecdsa\"").unwrap();
        assert_eq!(a, SigningAlgorithm::Ecdsa);
    }
}
```

- [ ] **Step 3: Wire the module into `lib.rs`**

Replace `crates/agicash-crypto/src/lib.rs`:

```rust
//! Encryption + key derivation helpers.

pub mod algorithm;

pub use algorithm::*;
```

- [ ] **Step 4: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-crypto`

Expected: FAIL — `SigningAlgorithm` does not exist.

- [ ] **Step 5: Implement `SigningAlgorithm`**

Replace `crates/agicash-crypto/src/algorithm.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SigningAlgorithm {
    Schnorr,
    Ecdsa,
}

#[derive(Debug, thiserror::Error)]
#[error("unknown signing algorithm: {0}")]
pub struct UnknownAlgorithm(pub String);

impl fmt::Display for SigningAlgorithm {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Schnorr => "schnorr",
            Self::Ecdsa => "ecdsa",
        })
    }
}

impl FromStr for SigningAlgorithm {
    type Err = UnknownAlgorithm;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "schnorr" => Ok(Self::Schnorr),
            "ecdsa" => Ok(Self::Ecdsa),
            _ => Err(UnknownAlgorithm(s.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn algorithm_display_uses_lowercase() {
        assert_eq!(SigningAlgorithm::Schnorr.to_string(), "schnorr");
        assert_eq!(SigningAlgorithm::Ecdsa.to_string(), "ecdsa");
    }

    #[test]
    fn algorithm_parses_case_insensitively() {
        assert_eq!(
            "schnorr".parse::<SigningAlgorithm>().unwrap(),
            SigningAlgorithm::Schnorr
        );
        assert_eq!(
            "ECDSA".parse::<SigningAlgorithm>().unwrap(),
            SigningAlgorithm::Ecdsa
        );
    }

    #[test]
    fn algorithm_parse_rejects_unknown() {
        assert!("ed25519".parse::<SigningAlgorithm>().is_err());
        assert!("".parse::<SigningAlgorithm>().is_err());
    }

    #[test]
    fn algorithm_serializes_as_lowercase() {
        let json = serde_json::to_string(&SigningAlgorithm::Schnorr).unwrap();
        assert_eq!(json, "\"schnorr\"");
    }

    #[test]
    fn algorithm_deserializes_from_lowercase() {
        let a: SigningAlgorithm = serde_json::from_str("\"ecdsa\"").unwrap();
        assert_eq!(a, SigningAlgorithm::Ecdsa);
    }
}
```

- [ ] **Step 6: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-crypto`

Expected: PASS — 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add crates/agicash-crypto
git commit -m "feat(crypto): add SigningAlgorithm enum (schnorr, ecdsa)"
```

---

## Task 3: `agicash-crypto` — `SecretKey` with zeroize-on-drop

**Files:**
- Create: `crates/agicash-crypto/src/secret_key.rs`
- Modify: `crates/agicash-crypto/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/agicash-crypto/src/secret_key.rs`:

```rust
use std::fmt;
use zeroize::Zeroizing;

#[cfg(test)]
mod tests {
    use super::*;

    const HEX_32: &str = "0101010101010101010101010101010101010101010101010101010101010101";

    #[test]
    fn secret_key_from_bytes_roundtrips() {
        let bytes = [0x42u8; 32];
        let k = SecretKey::new(bytes);
        assert_eq!(k.as_bytes(), &bytes);
    }

    #[test]
    fn secret_key_try_from_hex_parses_valid_input() {
        let k = SecretKey::try_from_hex(HEX_32).unwrap();
        assert_eq!(k.as_bytes(), &[0x01u8; 32]);
    }

    #[test]
    fn secret_key_try_from_hex_rejects_bad_length() {
        assert!(SecretKey::try_from_hex("aa").is_err());
        assert!(SecretKey::try_from_hex("").is_err());
    }

    #[test]
    fn secret_key_try_from_hex_rejects_non_hex() {
        assert!(SecretKey::try_from_hex(&"z".repeat(64)).is_err());
    }

    #[test]
    fn secret_key_debug_redacts() {
        let k = SecretKey::new([0x42u8; 32]);
        let dbg = format!("{k:?}");
        assert!(dbg.contains("SecretKey"));
        assert!(!dbg.contains("42"));
        assert!(!dbg.contains("66"));
    }
}
```

- [ ] **Step 2: Wire the module into `lib.rs`**

Replace `crates/agicash-crypto/src/lib.rs`:

```rust
//! Encryption + key derivation helpers.

pub mod algorithm;
pub mod secret_key;

pub use algorithm::*;
pub use secret_key::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-crypto`

Expected: FAIL — `SecretKey` does not exist.

- [ ] **Step 4: Implement `SecretKey`**

Replace `crates/agicash-crypto/src/secret_key.rs`:

```rust
use std::fmt;
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error)]
pub enum SecretKeyError {
    #[error("expected 32 hex bytes (64 chars), got {0} chars")]
    BadLength(usize),
    #[error("invalid hex: {0}")]
    InvalidHex(#[from] hex::FromHexError),
}

pub struct SecretKey(Zeroizing<[u8; 32]>);

impl SecretKey {
    #[must_use]
    pub fn new(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    pub fn try_from_hex(s: &str) -> Result<Self, SecretKeyError> {
        if s.len() != 64 {
            return Err(SecretKeyError::BadLength(s.len()));
        }
        let mut out = [0u8; 32];
        hex::decode_to_slice(s, &mut out)?;
        Ok(Self::new(out))
    }

    #[must_use]
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for SecretKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretKey(***)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEX_32: &str = "0101010101010101010101010101010101010101010101010101010101010101";

    #[test]
    fn secret_key_from_bytes_roundtrips() {
        let bytes = [0x42u8; 32];
        let k = SecretKey::new(bytes);
        assert_eq!(k.as_bytes(), &bytes);
    }

    #[test]
    fn secret_key_try_from_hex_parses_valid_input() {
        let k = SecretKey::try_from_hex(HEX_32).unwrap();
        assert_eq!(k.as_bytes(), &[0x01u8; 32]);
    }

    #[test]
    fn secret_key_try_from_hex_rejects_bad_length() {
        assert!(SecretKey::try_from_hex("aa").is_err());
        assert!(SecretKey::try_from_hex("").is_err());
    }

    #[test]
    fn secret_key_try_from_hex_rejects_non_hex() {
        assert!(SecretKey::try_from_hex(&"z".repeat(64)).is_err());
    }

    #[test]
    fn secret_key_debug_redacts() {
        let k = SecretKey::new([0x42u8; 32]);
        let dbg = format!("{k:?}");
        assert!(dbg.contains("SecretKey"));
        assert!(!dbg.contains("42"));
        assert!(!dbg.contains("66"));
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-crypto`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/agicash-crypto
git commit -m "feat(crypto): add SecretKey with zeroize-on-drop and redacted Debug"
```

---

## Task 4: `agicash-crypto` — `PublicKey`

**Files:**
- Create: `crates/agicash-crypto/src/public_key.rs`
- Modify: `crates/agicash-crypto/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/agicash-crypto/src/public_key.rs`:

```rust
use crate::SigningAlgorithm;
use serde::{Deserialize, Serialize};
use std::fmt;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_key_constructs_with_bytes_and_algorithm() {
        let k = PublicKey::new(vec![0xAA, 0xBB], SigningAlgorithm::Schnorr);
        assert_eq!(k.bytes(), &[0xAA, 0xBB]);
        assert_eq!(k.algorithm(), SigningAlgorithm::Schnorr);
    }

    #[test]
    fn public_key_display_is_hex() {
        let k = PublicKey::new(vec![0xDE, 0xAD, 0xBE, 0xEF], SigningAlgorithm::Ecdsa);
        assert_eq!(k.to_string(), "deadbeef");
    }

    #[test]
    fn public_key_roundtrips_through_json() {
        let k = PublicKey::new(vec![1, 2, 3], SigningAlgorithm::Schnorr);
        let json = serde_json::to_string(&k).unwrap();
        let parsed: PublicKey = serde_json::from_str(&json).unwrap();
        assert_eq!(k, parsed);
    }
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Replace `crates/agicash-crypto/src/lib.rs`:

```rust
//! Encryption + key derivation helpers.

pub mod algorithm;
pub mod public_key;
pub mod secret_key;

pub use algorithm::*;
pub use public_key::*;
pub use secret_key::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-crypto`

Expected: FAIL — `PublicKey` does not exist.

- [ ] **Step 4: Implement `PublicKey`**

Replace `crates/agicash-crypto/src/public_key.rs`:

```rust
use crate::SigningAlgorithm;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PublicKey {
    bytes: Vec<u8>,
    algorithm: SigningAlgorithm,
}

impl PublicKey {
    #[must_use]
    pub fn new(bytes: Vec<u8>, algorithm: SigningAlgorithm) -> Self {
        Self { bytes, algorithm }
    }

    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    #[must_use]
    pub fn algorithm(&self) -> SigningAlgorithm {
        self.algorithm
    }
}

impl fmt::Display for PublicKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&hex::encode(&self.bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_key_constructs_with_bytes_and_algorithm() {
        let k = PublicKey::new(vec![0xAA, 0xBB], SigningAlgorithm::Schnorr);
        assert_eq!(k.bytes(), &[0xAA, 0xBB]);
        assert_eq!(k.algorithm(), SigningAlgorithm::Schnorr);
    }

    #[test]
    fn public_key_display_is_hex() {
        let k = PublicKey::new(vec![0xDE, 0xAD, 0xBE, 0xEF], SigningAlgorithm::Ecdsa);
        assert_eq!(k.to_string(), "deadbeef");
    }

    #[test]
    fn public_key_roundtrips_through_json() {
        let k = PublicKey::new(vec![1, 2, 3], SigningAlgorithm::Schnorr);
        let json = serde_json::to_string(&k).unwrap();
        let parsed: PublicKey = serde_json::from_str(&json).unwrap();
        assert_eq!(k, parsed);
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-crypto`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/agicash-crypto
git commit -m "feat(crypto): add PublicKey type tagged by SigningAlgorithm"
```

---

## Task 5: `agicash-crypto` — `Signature`

**Files:**
- Create: `crates/agicash-crypto/src/signature.rs`
- Modify: `crates/agicash-crypto/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/agicash-crypto/src/signature.rs`:

```rust
use crate::SigningAlgorithm;
use serde::{Deserialize, Serialize};
use std::fmt;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_constructs_with_bytes_and_algorithm() {
        let s = Signature::new(vec![0x99], SigningAlgorithm::Schnorr);
        assert_eq!(s.bytes(), &[0x99]);
        assert_eq!(s.algorithm(), SigningAlgorithm::Schnorr);
    }

    #[test]
    fn signature_display_is_hex() {
        let s = Signature::new(vec![0xBE, 0xEF], SigningAlgorithm::Ecdsa);
        assert_eq!(s.to_string(), "beef");
    }

    #[test]
    fn signature_roundtrips_through_json() {
        let s = Signature::new(vec![1, 2, 3, 4], SigningAlgorithm::Ecdsa);
        let json = serde_json::to_string(&s).unwrap();
        let parsed: Signature = serde_json::from_str(&json).unwrap();
        assert_eq!(s, parsed);
    }
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Replace `crates/agicash-crypto/src/lib.rs`:

```rust
//! Encryption + key derivation helpers.

pub mod algorithm;
pub mod public_key;
pub mod secret_key;
pub mod signature;

pub use algorithm::*;
pub use public_key::*;
pub use secret_key::*;
pub use signature::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-crypto`

Expected: FAIL — `Signature` does not exist.

- [ ] **Step 4: Implement `Signature`**

Replace `crates/agicash-crypto/src/signature.rs`:

```rust
use crate::SigningAlgorithm;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Signature {
    bytes: Vec<u8>,
    algorithm: SigningAlgorithm,
}

impl Signature {
    #[must_use]
    pub fn new(bytes: Vec<u8>, algorithm: SigningAlgorithm) -> Self {
        Self { bytes, algorithm }
    }

    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    #[must_use]
    pub fn algorithm(&self) -> SigningAlgorithm {
        self.algorithm
    }
}

impl fmt::Display for Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&hex::encode(&self.bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_constructs_with_bytes_and_algorithm() {
        let s = Signature::new(vec![0x99], SigningAlgorithm::Schnorr);
        assert_eq!(s.bytes(), &[0x99]);
        assert_eq!(s.algorithm(), SigningAlgorithm::Schnorr);
    }

    #[test]
    fn signature_display_is_hex() {
        let s = Signature::new(vec![0xBE, 0xEF], SigningAlgorithm::Ecdsa);
        assert_eq!(s.to_string(), "beef");
    }

    #[test]
    fn signature_roundtrips_through_json() {
        let s = Signature::new(vec![1, 2, 3, 4], SigningAlgorithm::Ecdsa);
        let json = serde_json::to_string(&s).unwrap();
        let parsed: Signature = serde_json::from_str(&json).unwrap();
        assert_eq!(s, parsed);
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-crypto`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/agicash-crypto
git commit -m "feat(crypto): add Signature type tagged by SigningAlgorithm"
```

---

## Task 6: `agicash-crypto` — `Mnemonic`

**Files:**
- Create: `crates/agicash-crypto/src/mnemonic.rs`
- Modify: `crates/agicash-crypto/src/lib.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/agicash-crypto/src/mnemonic.rs`:

```rust
use std::fmt;

#[cfg(test)]
mod tests {
    use super::*;

    // Standard BIP39 test vector (12 words, all zeros entropy).
    const VALID_12: &str =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn mnemonic_parse_accepts_valid_12_word_phrase() {
        let m = Mnemonic::parse(VALID_12).unwrap();
        assert_eq!(m.phrase(), VALID_12);
    }

    #[test]
    fn mnemonic_parse_rejects_invalid_phrase() {
        assert!(Mnemonic::parse("not a real mnemonic phrase at all here please").is_err());
        assert!(Mnemonic::parse("").is_err());
    }

    #[test]
    fn mnemonic_parse_rejects_bad_checksum() {
        // 12 valid words but wrong checksum (last word swapped).
        let bad = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon";
        assert!(Mnemonic::parse(bad).is_err());
    }

    #[test]
    fn mnemonic_debug_redacts() {
        let m = Mnemonic::parse(VALID_12).unwrap();
        let dbg = format!("{m:?}");
        assert!(dbg.contains("Mnemonic"));
        assert!(!dbg.contains("abandon"));
        assert!(!dbg.contains("about"));
    }
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Replace `crates/agicash-crypto/src/lib.rs`:

```rust
//! Encryption + key derivation helpers.

pub mod algorithm;
pub mod mnemonic;
pub mod public_key;
pub mod secret_key;
pub mod signature;

pub use algorithm::*;
pub use mnemonic::*;
pub use public_key::*;
pub use secret_key::*;
pub use signature::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-crypto`

Expected: FAIL — `Mnemonic` does not exist.

- [ ] **Step 4: Implement `Mnemonic`**

Replace `crates/agicash-crypto/src/mnemonic.rs`:

```rust
use std::fmt;

#[derive(Debug, thiserror::Error)]
#[error("invalid BIP39 mnemonic: {0}")]
pub struct MnemonicError(pub String);

pub struct Mnemonic(String);

impl Mnemonic {
    pub fn parse(phrase: &str) -> Result<Self, MnemonicError> {
        bip39::Mnemonic::parse(phrase).map_err(|e| MnemonicError(e.to_string()))?;
        Ok(Self(phrase.to_string()))
    }

    #[must_use]
    pub fn phrase(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Mnemonic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Mnemonic(***)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_12: &str =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn mnemonic_parse_accepts_valid_12_word_phrase() {
        let m = Mnemonic::parse(VALID_12).unwrap();
        assert_eq!(m.phrase(), VALID_12);
    }

    #[test]
    fn mnemonic_parse_rejects_invalid_phrase() {
        assert!(Mnemonic::parse("not a real mnemonic phrase at all here please").is_err());
        assert!(Mnemonic::parse("").is_err());
    }

    #[test]
    fn mnemonic_parse_rejects_bad_checksum() {
        let bad = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon";
        assert!(Mnemonic::parse(bad).is_err());
    }

    #[test]
    fn mnemonic_debug_redacts() {
        let m = Mnemonic::parse(VALID_12).unwrap();
        let dbg = format!("{m:?}");
        assert!(dbg.contains("Mnemonic"));
        assert!(!dbg.contains("abandon"));
        assert!(!dbg.contains("about"));
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-crypto`

Expected: PASS — all crypto tests succeed.

- [ ] **Step 6: Commit**

```bash
git add crates/agicash-crypto
git commit -m "feat(crypto): add Mnemonic type with BIP39 validation and redacted Debug"
```

---

## Task 7: `agicash-traits` — `AuthError` and `KeyOptions`

**Files:**
- Modify: `crates/agicash-traits/Cargo.toml`
- Modify: `crates/agicash-traits/src/lib.rs`
- Create: `crates/agicash-traits/src/error.rs`
- Create: `crates/agicash-traits/src/key_options.rs`

- [ ] **Step 1: Update the crate manifest**

Replace `crates/agicash-traits/Cargo.toml`:

```toml
[package]
name = "agicash-traits"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-crypto = { path = "../agicash-crypto" }
async-trait = { workspace = true }
serde = { workspace = true }
thiserror = { workspace = true }

[lints]
workspace = true
```

- [ ] **Step 2: Write failing tests for `AuthError`**

Create `crates/agicash-traits/src/error.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_error_display_covers_each_variant() {
        let n = AuthError::Network("dns".into());
        assert!(n.to_string().contains("network"));

        let u = AuthError::Unauthenticated;
        assert!(u.to_string().to_lowercase().contains("auth"));

        let b = AuthError::Backend("oops".into());
        assert!(b.to_string().contains("oops"));

        let i = AuthError::Internal("bug".into());
        assert!(i.to_string().contains("bug"));
    }
}
```

- [ ] **Step 3: Wire into `lib.rs` and write failing tests for `KeyOptions`**

Create `crates/agicash-traits/src/key_options.rs`:

```rust
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_options_default_is_empty() {
        let opts = KeyOptions::default();
        assert!(opts.private_key_derivation_path.is_none());
        assert!(opts.seed_phrase_derivation_path.is_none());
    }

    #[test]
    fn key_options_with_paths_constructs() {
        let opts = KeyOptions {
            private_key_derivation_path: Some("m/0'/0".into()),
            seed_phrase_derivation_path: None,
        };
        assert_eq!(
            opts.private_key_derivation_path.as_deref(),
            Some("m/0'/0")
        );
    }
}
```

Replace `crates/agicash-traits/src/lib.rs`:

```rust
//! Trait boundaries between abstract and concrete impls.

pub mod error;
pub mod key_options;

pub use error::*;
pub use key_options::*;
```

- [ ] **Step 4: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-traits`

Expected: FAIL — `AuthError` and `KeyOptions` do not exist.

- [ ] **Step 5: Implement `AuthError`**

Replace `crates/agicash-traits/src/error.rs`:

```rust
#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("network: {0}")]
    Network(String),
    #[error("not authenticated")]
    Unauthenticated,
    #[error("auth backend error: {0}")]
    Backend(String),
    #[error("internal error: {0}")]
    Internal(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_error_display_covers_each_variant() {
        let n = AuthError::Network("dns".into());
        assert!(n.to_string().contains("network"));

        let u = AuthError::Unauthenticated;
        assert!(u.to_string().to_lowercase().contains("auth"));

        let b = AuthError::Backend("oops".into());
        assert!(b.to_string().contains("oops"));

        let i = AuthError::Internal("bug".into());
        assert!(i.to_string().contains("bug"));
    }
}
```

- [ ] **Step 6: Implement `KeyOptions`**

Replace `crates/agicash-traits/src/key_options.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct KeyOptions {
    pub private_key_derivation_path: Option<String>,
    pub seed_phrase_derivation_path: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_options_default_is_empty() {
        let opts = KeyOptions::default();
        assert!(opts.private_key_derivation_path.is_none());
        assert!(opts.seed_phrase_derivation_path.is_none());
    }

    #[test]
    fn key_options_with_paths_constructs() {
        let opts = KeyOptions {
            private_key_derivation_path: Some("m/0'/0".into()),
            seed_phrase_derivation_path: None,
        };
        assert_eq!(
            opts.private_key_derivation_path.as_deref(),
            Some("m/0'/0")
        );
    }
}
```

- [ ] **Step 7: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-traits`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add crates/agicash-traits
git commit -m "feat(traits): add AuthError enum and KeyOptions struct"
```

---

## Task 8: `agicash-traits` — `KeyProvider` trait

**Files:**
- Create: `crates/agicash-traits/src/key_provider.rs`
- Modify: `crates/agicash-traits/src/lib.rs`

- [ ] **Step 1: Write the failing compile-only test**

Create `crates/agicash-traits/src/key_provider.rs`:

```rust
use crate::{AuthError, KeyOptions};
use agicash_crypto::{Mnemonic, PublicKey, SecretKey, Signature, SigningAlgorithm};
use async_trait::async_trait;

#[cfg(test)]
mod tests {
    use super::*;

    struct DummyProvider;

    #[async_trait]
    impl KeyProvider for DummyProvider {
        async fn derive_private_key(
            &self,
            _options: KeyOptions,
        ) -> Result<SecretKey, AuthError> {
            Ok(SecretKey::new([0u8; 32]))
        }

        async fn derive_public_key(
            &self,
            _algorithm: SigningAlgorithm,
            _options: KeyOptions,
        ) -> Result<PublicKey, AuthError> {
            Ok(PublicKey::new(vec![], SigningAlgorithm::Schnorr))
        }

        async fn sign_message(
            &self,
            _message: &[u8],
            _algorithm: SigningAlgorithm,
            _options: KeyOptions,
        ) -> Result<Signature, AuthError> {
            Ok(Signature::new(vec![], SigningAlgorithm::Schnorr))
        }

        async fn get_mnemonic(&self) -> Result<Mnemonic, AuthError> {
            Mnemonic::parse(
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            )
            .map_err(|e| AuthError::Internal(e.to_string()))
        }
    }

    #[tokio::test]
    async fn dummy_provider_implements_key_provider() {
        let p = DummyProvider;
        let _ = p.derive_private_key(KeyOptions::default()).await.unwrap();
        let _ = p
            .derive_public_key(SigningAlgorithm::Schnorr, KeyOptions::default())
            .await
            .unwrap();
        let _ = p
            .sign_message(b"hi", SigningAlgorithm::Schnorr, KeyOptions::default())
            .await
            .unwrap();
        let _ = p.get_mnemonic().await.unwrap();
    }
}
```

Note: This test needs `tokio` as a dev-dep. Add it.

- [ ] **Step 2: Add `tokio` as a dev-dep**

Edit `crates/agicash-traits/Cargo.toml` to add:

```toml
[dev-dependencies]
tokio = { workspace = true }
```

- [ ] **Step 3: Wire into `lib.rs`**

Replace `crates/agicash-traits/src/lib.rs`:

```rust
//! Trait boundaries between abstract and concrete impls.

pub mod error;
pub mod key_options;
pub mod key_provider;

pub use error::*;
pub use key_options::*;
pub use key_provider::*;
```

- [ ] **Step 4: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-traits`

Expected: FAIL — `KeyProvider` trait does not exist.

- [ ] **Step 5: Implement the trait**

Replace `crates/agicash-traits/src/key_provider.rs`:

```rust
use crate::{AuthError, KeyOptions};
use agicash_crypto::{Mnemonic, PublicKey, SecretKey, Signature, SigningAlgorithm};
use async_trait::async_trait;

#[async_trait]
pub trait KeyProvider: Send + Sync {
    async fn derive_private_key(&self, options: KeyOptions) -> Result<SecretKey, AuthError>;

    async fn derive_public_key(
        &self,
        algorithm: SigningAlgorithm,
        options: KeyOptions,
    ) -> Result<PublicKey, AuthError>;

    async fn sign_message(
        &self,
        message: &[u8],
        algorithm: SigningAlgorithm,
        options: KeyOptions,
    ) -> Result<Signature, AuthError>;

    async fn get_mnemonic(&self) -> Result<Mnemonic, AuthError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct DummyProvider;

    #[async_trait]
    impl KeyProvider for DummyProvider {
        async fn derive_private_key(
            &self,
            _options: KeyOptions,
        ) -> Result<SecretKey, AuthError> {
            Ok(SecretKey::new([0u8; 32]))
        }

        async fn derive_public_key(
            &self,
            _algorithm: SigningAlgorithm,
            _options: KeyOptions,
        ) -> Result<PublicKey, AuthError> {
            Ok(PublicKey::new(vec![], SigningAlgorithm::Schnorr))
        }

        async fn sign_message(
            &self,
            _message: &[u8],
            _algorithm: SigningAlgorithm,
            _options: KeyOptions,
        ) -> Result<Signature, AuthError> {
            Ok(Signature::new(vec![], SigningAlgorithm::Schnorr))
        }

        async fn get_mnemonic(&self) -> Result<Mnemonic, AuthError> {
            Mnemonic::parse(
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            )
            .map_err(|e| AuthError::Internal(e.to_string()))
        }
    }

    #[tokio::test]
    async fn dummy_provider_implements_key_provider() {
        let p = DummyProvider;
        let _ = p.derive_private_key(KeyOptions::default()).await.unwrap();
        let _ = p
            .derive_public_key(SigningAlgorithm::Schnorr, KeyOptions::default())
            .await
            .unwrap();
        let _ = p
            .sign_message(b"hi", SigningAlgorithm::Schnorr, KeyOptions::default())
            .await
            .unwrap();
        let _ = p.get_mnemonic().await.unwrap();
    }
}
```

- [ ] **Step 6: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-traits`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/agicash-traits
git commit -m "feat(traits): add KeyProvider trait with 4 async methods"
```

---

## Task 9: `agicash-traits` — `TokenProvider` trait

**Files:**
- Create: `crates/agicash-traits/src/token_provider.rs`
- Modify: `crates/agicash-traits/src/lib.rs`

- [ ] **Step 1: Write the failing compile-only test**

Create `crates/agicash-traits/src/token_provider.rs`:

```rust
use crate::AuthError;
use async_trait::async_trait;

#[cfg(test)]
mod tests {
    use super::*;

    struct DummyToken;

    #[async_trait]
    impl TokenProvider for DummyToken {
        async fn get_jwt(&self) -> Result<String, AuthError> {
            Ok("token".to_string())
        }
    }

    #[tokio::test]
    async fn dummy_token_provider_returns_jwt() {
        assert_eq!(DummyToken.get_jwt().await.unwrap(), "token");
    }
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Replace `crates/agicash-traits/src/lib.rs`:

```rust
//! Trait boundaries between abstract and concrete impls.

pub mod error;
pub mod key_options;
pub mod key_provider;
pub mod token_provider;

pub use error::*;
pub use key_options::*;
pub use key_provider::*;
pub use token_provider::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-traits`

Expected: FAIL — `TokenProvider` does not exist.

- [ ] **Step 4: Implement the trait**

Replace `crates/agicash-traits/src/token_provider.rs`:

```rust
use crate::AuthError;
use async_trait::async_trait;

#[async_trait]
pub trait TokenProvider: Send + Sync {
    async fn get_jwt(&self) -> Result<String, AuthError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct DummyToken;

    #[async_trait]
    impl TokenProvider for DummyToken {
        async fn get_jwt(&self) -> Result<String, AuthError> {
            Ok("token".to_string())
        }
    }

    #[tokio::test]
    async fn dummy_token_provider_returns_jwt() {
        assert_eq!(DummyToken.get_jwt().await.unwrap(), "token");
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-traits`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/agicash-traits
git commit -m "feat(traits): add TokenProvider trait with get_jwt method"
```

---

## Task 10: `agicash-traits` — `SessionStorage` trait with `PersistedSession`

**Files:**
- Create: `crates/agicash-traits/src/session_storage.rs`
- Modify: `crates/agicash-traits/src/lib.rs`

The trait stores a small struct, not just a refresh token, because we want `auth status` to print the user id after process restart without making an extra opensecret call (and without parsing JWTs).

- [ ] **Step 1: Write the failing tests**

Create `crates/agicash-traits/src/session_storage.rs`:

```rust
use crate::AuthError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct InMemStorage {
        session: Mutex<Option<PersistedSession>>,
    }

    #[async_trait]
    impl SessionStorage for InMemStorage {
        async fn store(&self, session: &PersistedSession) -> Result<(), AuthError> {
            *self.session.lock().unwrap() = Some(session.clone());
            Ok(())
        }

        async fn load(&self) -> Result<Option<PersistedSession>, AuthError> {
            Ok(self.session.lock().unwrap().clone())
        }

        async fn clear(&self) -> Result<(), AuthError> {
            *self.session.lock().unwrap() = None;
            Ok(())
        }
    }

    #[tokio::test]
    async fn in_mem_storage_roundtrips() {
        let s = InMemStorage::default();
        assert!(s.load().await.unwrap().is_none());
        let session = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "rt".to_string(),
        };
        s.store(&session).await.unwrap();
        assert_eq!(s.load().await.unwrap(), Some(session));
        s.clear().await.unwrap();
        assert!(s.load().await.unwrap().is_none());
    }

    #[test]
    fn persisted_session_roundtrips_through_json() {
        let session = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "abc.def.ghi".to_string(),
        };
        let json = serde_json::to_string(&session).unwrap();
        let parsed: PersistedSession = serde_json::from_str(&json).unwrap();
        assert_eq!(session, parsed);
    }
}
```

- [ ] **Step 2: Add `uuid` and `serde_json` to traits crate**

Update `crates/agicash-traits/Cargo.toml`:

```toml
[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-crypto = { path = "../agicash-crypto" }
async-trait = { workspace = true }
serde = { workspace = true }
thiserror = { workspace = true }
uuid = { workspace = true }

[dev-dependencies]
tokio = { workspace = true }
serde_json = { workspace = true }

[lints]
workspace = true
```

- [ ] **Step 3: Wire into `lib.rs`**

Replace `crates/agicash-traits/src/lib.rs`:

```rust
//! Trait boundaries between abstract and concrete impls.

pub mod error;
pub mod key_options;
pub mod key_provider;
pub mod session_storage;
pub mod token_provider;

pub use error::*;
pub use key_options::*;
pub use key_provider::*;
pub use session_storage::*;
pub use token_provider::*;
```

- [ ] **Step 4: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-traits`

Expected: FAIL — `SessionStorage` and `PersistedSession` do not exist.

- [ ] **Step 5: Implement the trait + struct**

Replace `crates/agicash-traits/src/session_storage.rs`:

```rust
use crate::AuthError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistedSession {
    pub user_id: Uuid,
    pub refresh_token: String,
}

#[async_trait]
pub trait SessionStorage: Send + Sync {
    async fn store(&self, session: &PersistedSession) -> Result<(), AuthError>;
    async fn load(&self) -> Result<Option<PersistedSession>, AuthError>;
    async fn clear(&self) -> Result<(), AuthError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct InMemStorage {
        session: Mutex<Option<PersistedSession>>,
    }

    #[async_trait]
    impl SessionStorage for InMemStorage {
        async fn store(&self, session: &PersistedSession) -> Result<(), AuthError> {
            *self.session.lock().unwrap() = Some(session.clone());
            Ok(())
        }

        async fn load(&self) -> Result<Option<PersistedSession>, AuthError> {
            Ok(self.session.lock().unwrap().clone())
        }

        async fn clear(&self) -> Result<(), AuthError> {
            *self.session.lock().unwrap() = None;
            Ok(())
        }
    }

    #[tokio::test]
    async fn in_mem_storage_roundtrips() {
        let s = InMemStorage::default();
        assert!(s.load().await.unwrap().is_none());
        let session = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "rt".to_string(),
        };
        s.store(&session).await.unwrap();
        assert_eq!(s.load().await.unwrap(), Some(session));
        s.clear().await.unwrap();
        assert!(s.load().await.unwrap().is_none());
    }

    #[test]
    fn persisted_session_roundtrips_through_json() {
        let session = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "abc.def.ghi".to_string(),
        };
        let json = serde_json::to_string(&session).unwrap();
        let parsed: PersistedSession = serde_json::from_str(&json).unwrap();
        assert_eq!(session, parsed);
    }
}
```

- [ ] **Step 6: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-traits`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/agicash-traits
git commit -m "feat(traits): add SessionStorage trait + PersistedSession {user_id, refresh_token}"
```

---

## Task 11: `agicash-auth-opensecret` — `OpenSecretConfig` from env

**Files:**
- Modify: `crates/agicash-auth-opensecret/Cargo.toml`
- Modify: `crates/agicash-auth-opensecret/src/lib.rs`
- Create: `crates/agicash-auth-opensecret/src/config.rs`

- [ ] **Step 1: Update the crate manifest**

Replace `crates/agicash-auth-opensecret/Cargo.toml`:

```toml
[package]
name = "agicash-auth-opensecret"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[features]
default = []
# Enable integration tests that hit the real Open Secret dev environment.
# Requires OPENSECRET_BASE_URL and OPENSECRET_CLIENT_ID env vars.
real-opensecret-tests = []

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-crypto = { path = "../agicash-crypto" }
agicash-traits = { path = "../agicash-traits" }
opensecret = { workspace = true }
keyring = { workspace = true }
tokio = { workspace = true }
async-trait = { workspace = true }
uuid = { workspace = true }
hex = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
thiserror = { workspace = true }

[lints]
workspace = true
```

- [ ] **Step 2: Write failing tests for `OpenSecretConfig`**

Create `crates/agicash-auth-opensecret/src/config.rs`:

```rust
use agicash_traits::AuthError;
use uuid::Uuid;

#[cfg(test)]
mod tests {
    use super::*;

    fn unique(prefix: &str) -> (String, String) {
        let pid = std::process::id();
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        (format!("{prefix}_BASE_URL_{pid}_{n}"), format!("{prefix}_CLIENT_ID_{pid}_{n}"))
    }

    #[test]
    fn from_env_reads_both_vars() {
        let (url_var, id_var) = unique("AGICASH_T1");
        let uuid = Uuid::new_v4();
        std::env::set_var(&url_var, "https://example.test");
        std::env::set_var(&id_var, uuid.to_string());

        let cfg = OpenSecretConfig::from_env_vars(&url_var, &id_var).unwrap();
        assert_eq!(cfg.base_url, "https://example.test");
        assert_eq!(cfg.client_id, uuid);

        std::env::remove_var(&url_var);
        std::env::remove_var(&id_var);
    }

    #[test]
    fn from_env_errors_when_missing_base_url() {
        let (url_var, id_var) = unique("AGICASH_T2");
        std::env::set_var(&id_var, Uuid::new_v4().to_string());
        let err = OpenSecretConfig::from_env_vars(&url_var, &id_var).unwrap_err();
        assert!(matches!(err, AuthError::Internal(_)));
        std::env::remove_var(&id_var);
    }

    #[test]
    fn from_env_errors_on_bad_uuid() {
        let (url_var, id_var) = unique("AGICASH_T3");
        std::env::set_var(&url_var, "https://example.test");
        std::env::set_var(&id_var, "not-a-uuid");
        let err = OpenSecretConfig::from_env_vars(&url_var, &id_var).unwrap_err();
        assert!(matches!(err, AuthError::Internal(_)));
        std::env::remove_var(&url_var);
        std::env::remove_var(&id_var);
    }
}
```

- [ ] **Step 3: Wire into `lib.rs`**

Replace `crates/agicash-auth-opensecret/src/lib.rs`:

```rust
//! `KeyProvider` + `TokenProvider` impls over opensecret 0.2.9.

pub mod config;

pub use config::*;
```

- [ ] **Step 4: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-auth-opensecret`

Expected: FAIL — `OpenSecretConfig` does not exist.

- [ ] **Step 5: Implement `OpenSecretConfig`**

Replace `crates/agicash-auth-opensecret/src/config.rs`:

```rust
use agicash_traits::AuthError;
use uuid::Uuid;

pub const ENV_BASE_URL: &str = "OPENSECRET_BASE_URL";
pub const ENV_CLIENT_ID: &str = "OPENSECRET_CLIENT_ID";

#[derive(Debug, Clone)]
pub struct OpenSecretConfig {
    pub base_url: String,
    pub client_id: Uuid,
}

impl OpenSecretConfig {
    pub fn from_env() -> Result<Self, AuthError> {
        Self::from_env_vars(ENV_BASE_URL, ENV_CLIENT_ID)
    }

    pub fn from_env_vars(url_var: &str, id_var: &str) -> Result<Self, AuthError> {
        let base_url = std::env::var(url_var)
            .map_err(|_| AuthError::Internal(format!("missing env var: {url_var}")))?;
        let client_id_raw = std::env::var(id_var)
            .map_err(|_| AuthError::Internal(format!("missing env var: {id_var}")))?;
        let client_id = Uuid::parse_str(&client_id_raw)
            .map_err(|e| AuthError::Internal(format!("invalid {id_var}: {e}")))?;
        Ok(Self { base_url, client_id })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique(prefix: &str) -> (String, String) {
        let pid = std::process::id();
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        (
            format!("{prefix}_BASE_URL_{pid}_{n}"),
            format!("{prefix}_CLIENT_ID_{pid}_{n}"),
        )
    }

    #[test]
    fn from_env_reads_both_vars() {
        let (url_var, id_var) = unique("AGICASH_T1");
        let uuid = Uuid::new_v4();
        std::env::set_var(&url_var, "https://example.test");
        std::env::set_var(&id_var, uuid.to_string());

        let cfg = OpenSecretConfig::from_env_vars(&url_var, &id_var).unwrap();
        assert_eq!(cfg.base_url, "https://example.test");
        assert_eq!(cfg.client_id, uuid);

        std::env::remove_var(&url_var);
        std::env::remove_var(&id_var);
    }

    #[test]
    fn from_env_errors_when_missing_base_url() {
        let (url_var, id_var) = unique("AGICASH_T2");
        std::env::set_var(&id_var, Uuid::new_v4().to_string());
        let err = OpenSecretConfig::from_env_vars(&url_var, &id_var).unwrap_err();
        assert!(matches!(err, AuthError::Internal(_)));
        std::env::remove_var(&id_var);
    }

    #[test]
    fn from_env_errors_on_bad_uuid() {
        let (url_var, id_var) = unique("AGICASH_T3");
        std::env::set_var(&url_var, "https://example.test");
        std::env::set_var(&id_var, "not-a-uuid");
        let err = OpenSecretConfig::from_env_vars(&url_var, &id_var).unwrap_err();
        assert!(matches!(err, AuthError::Internal(_)));
        std::env::remove_var(&url_var);
        std::env::remove_var(&id_var);
    }
}
```

- [ ] **Step 6: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-auth-opensecret`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/agicash-auth-opensecret
git commit -m "feat(auth-opensecret): add OpenSecretConfig with env-var parsing"
```

---

## Task 12: `agicash-auth-opensecret` — `OpenSecretClient` wrapper + error mapping

**Files:**
- Create: `crates/agicash-auth-opensecret/src/error.rs`
- Create: `crates/agicash-auth-opensecret/src/client.rs`
- Modify: `crates/agicash-auth-opensecret/src/lib.rs`

- [ ] **Step 1: Write the failing client tests**

Create `crates/agicash-auth-opensecret/src/client.rs`:

```rust
use crate::OpenSecretConfig;
use agicash_traits::AuthError;
use std::sync::Arc;
use tokio::sync::OnceCell;

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn fake_cfg() -> OpenSecretConfig {
        OpenSecretConfig {
            base_url: "https://does-not-resolve-agicash.invalid".to_string(),
            client_id: Uuid::nil(),
        }
    }

    #[tokio::test]
    async fn client_constructs_without_network() {
        let c = OpenSecretClient::new(fake_cfg()).unwrap();
        let _ = c.inner();
    }

    #[tokio::test]
    async fn handshake_runs_at_most_once() {
        let c = OpenSecretClient::new(fake_cfg()).unwrap();
        let r1 = c.ensure_handshake().await;
        let r2 = c.ensure_handshake().await;
        assert!(r1.is_err());
        assert!(r2.is_err());
    }
}
```

- [ ] **Step 2: Write the failing error-mapping test**

Create `crates/agicash-auth-opensecret/src/error.rs`:

```rust
use agicash_traits::AuthError;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opensecret_error_maps_to_auth_error() {
        // Sanity: the From impl exists and produces a non-empty message.
        let err: opensecret::Error = opensecret::Error::Other("boom".to_string());
        let mapped: AuthError = err.into();
        assert!(format!("{mapped}").contains("boom") || matches!(mapped, AuthError::Backend(_)));
    }
}
```

If `opensecret::Error::Other` doesn't exist on 0.2.9, grep the opensecret crate source for the actual variant. The source lives at `~/agicash/node_modules/@agicash/opensecret-sdk/rust/`. Pick any constructible variant and update the test accordingly; the goal is just to confirm `From<opensecret::Error> for AuthError` compiles and produces a `Backend(String)`-shaped error.

- [ ] **Step 3: Wire into `lib.rs`**

Replace `crates/agicash-auth-opensecret/src/lib.rs`:

```rust
//! `KeyProvider` + `TokenProvider` impls over opensecret 0.2.9.

pub mod client;
pub mod config;
pub mod error;

pub use client::*;
pub use config::*;
```

- [ ] **Step 4: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-auth-opensecret`

Expected: FAIL — `OpenSecretClient` and the `From<opensecret::Error>` impl do not exist.

- [ ] **Step 5: Implement the error mapping**

Replace `crates/agicash-auth-opensecret/src/error.rs`:

```rust
use agicash_traits::AuthError;

impl From<opensecret::Error> for AuthError {
    fn from(err: opensecret::Error) -> Self {
        // Map all opensecret errors to Backend by default with the Display
        // string. The variant set in opensecret 0.2.9 is small; if any
        // variant clearly maps to Unauthenticated (e.g., a 401), refine
        // here when wiring concrete calls. The CLI surfaces this via
        // Display and exits with the right code.
        AuthError::Backend(format!("{err}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opensecret_error_maps_to_auth_error() {
        // Grep `opensecret` crate for any constructible Error variant. We
        // assert the From impl compiles and produces a Backend-shaped
        // AuthError. Adjust the constructor if 0.2.9's variant names
        // differ from what this stub assumes.
        let err: opensecret::Error = opensecret::Error::Other("boom".to_string());
        let mapped: AuthError = err.into();
        assert!(matches!(mapped, AuthError::Backend(_)));
        assert!(format!("{mapped}").contains("boom"));
    }
}
```

If `opensecret::Error::Other` isn't a valid constructor in 0.2.9, replace the test's constructed value with whatever variant is reachable (e.g., `opensecret::Error::HandshakeMissing` if that exists).

- [ ] **Step 6: Implement `OpenSecretClient`**

Replace `crates/agicash-auth-opensecret/src/client.rs`:

```rust
use crate::OpenSecretConfig;
use agicash_traits::AuthError;
use std::sync::Arc;
use tokio::sync::OnceCell;

#[derive(Debug, Clone)]
pub struct OpenSecretClient {
    inner: Arc<opensecret::Client>,
    handshake: Arc<OnceCell<()>>,
    config: OpenSecretConfig,
}

impl OpenSecretClient {
    pub fn new(config: OpenSecretConfig) -> Result<Self, AuthError> {
        let inner = opensecret::Client::new(config.base_url.clone()).map_err(AuthError::from)?;
        Ok(Self {
            inner: Arc::new(inner),
            handshake: Arc::new(OnceCell::new()),
            config,
        })
    }

    pub async fn ensure_handshake(&self) -> Result<(), AuthError> {
        self.handshake
            .get_or_try_init(|| async {
                self.inner
                    .perform_attestation_handshake()
                    .await
                    .map_err(AuthError::from)
            })
            .await
            .map(|_| ())
    }

    #[must_use]
    pub fn inner(&self) -> &opensecret::Client {
        &self.inner
    }

    #[must_use]
    pub fn client_id(&self) -> uuid::Uuid {
        self.config.client_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn fake_cfg() -> OpenSecretConfig {
        OpenSecretConfig {
            base_url: "https://does-not-resolve-agicash.invalid".to_string(),
            client_id: Uuid::nil(),
        }
    }

    #[tokio::test]
    async fn client_constructs_without_network() {
        let c = OpenSecretClient::new(fake_cfg()).unwrap();
        let _ = c.inner();
    }

    #[tokio::test]
    async fn handshake_runs_at_most_once() {
        let c = OpenSecretClient::new(fake_cfg()).unwrap();
        let r1 = c.ensure_handshake().await;
        let r2 = c.ensure_handshake().await;
        assert!(r1.is_err());
        assert!(r2.is_err());
    }
}
```

If `opensecret::Client::new` is non-fallible on 0.2.9, drop the `?` and `.map_err`. Verify against `~/agicash/node_modules/@agicash/opensecret-sdk/rust/` before implementing.

- [ ] **Step 7: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-auth-opensecret`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add crates/agicash-auth-opensecret
git commit -m "feat(auth-opensecret): add OpenSecretClient with OnceCell handshake guard"
```

---

## Task 13: `agicash-auth-opensecret` — auth session wrappers

**Files:**
- Create: `crates/agicash-auth-opensecret/src/session.rs`
- Modify: `crates/agicash-auth-opensecret/src/lib.rs`

- [ ] **Step 1: Write failing compile-only tests**

Create `crates/agicash-auth-opensecret/src/session.rs`:

```rust
use crate::OpenSecretClient;
use agicash_traits::AuthError;
use uuid::Uuid;

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(dead_code)]
    async fn _typecheck(client: &OpenSecretClient) {
        let _: Result<opensecret::LoginResponse, AuthError> =
            login_email(client, "a@b.test".into(), "pw".into(), Uuid::nil()).await;
        let _: Result<opensecret::LoginResponse, AuthError> =
            login_guest_by_id(client, Uuid::nil(), "pw".into(), Uuid::nil()).await;
        let _: Result<opensecret::LoginResponse, AuthError> =
            register_guest(client, "pw".into(), Uuid::nil()).await;
        let _: Result<opensecret::LoginResponse, AuthError> =
            register_email(client, "a@b.test".into(), "pw".into(), Uuid::nil(), None).await;
        let _: Result<(), AuthError> = logout(client).await;
        let _: Result<(), AuthError> = refresh(client).await;
    }
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Replace `crates/agicash-auth-opensecret/src/lib.rs`:

```rust
//! `KeyProvider` + `TokenProvider` impls over opensecret 0.2.9.

pub mod client;
pub mod config;
pub mod error;
pub mod session;

pub use client::*;
pub use config::*;
pub use session::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-auth-opensecret`

Expected: FAIL — session functions do not exist.

- [ ] **Step 4: Implement the session wrappers**

Replace `crates/agicash-auth-opensecret/src/session.rs`:

```rust
use crate::OpenSecretClient;
use agicash_traits::AuthError;
use uuid::Uuid;

pub async fn login_email(
    client: &OpenSecretClient,
    email: String,
    password: String,
    client_id: Uuid,
) -> Result<opensecret::LoginResponse, AuthError> {
    client.ensure_handshake().await?;
    client
        .inner()
        .login(email, password, client_id)
        .await
        .map_err(AuthError::from)
}

pub async fn login_guest_by_id(
    client: &OpenSecretClient,
    id: Uuid,
    password: String,
    client_id: Uuid,
) -> Result<opensecret::LoginResponse, AuthError> {
    client.ensure_handshake().await?;
    client
        .inner()
        .login_with_id(id, password, client_id)
        .await
        .map_err(AuthError::from)
}

pub async fn register_guest(
    client: &OpenSecretClient,
    password: String,
    client_id: Uuid,
) -> Result<opensecret::LoginResponse, AuthError> {
    client.ensure_handshake().await?;
    client
        .inner()
        .register_guest(password, client_id)
        .await
        .map_err(AuthError::from)
}

pub async fn register_email(
    client: &OpenSecretClient,
    email: String,
    password: String,
    client_id: Uuid,
    name: Option<String>,
) -> Result<opensecret::LoginResponse, AuthError> {
    client.ensure_handshake().await?;
    client
        .inner()
        .register(email, password, client_id, name)
        .await
        .map_err(AuthError::from)
}

pub async fn logout(client: &OpenSecretClient) -> Result<(), AuthError> {
    client.ensure_handshake().await?;
    client.inner().logout().await.map_err(AuthError::from)
}

pub async fn refresh(client: &OpenSecretClient) -> Result<(), AuthError> {
    client.ensure_handshake().await?;
    client.inner().refresh_token().await.map_err(AuthError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(dead_code)]
    async fn _typecheck(client: &OpenSecretClient) {
        let _: Result<opensecret::LoginResponse, AuthError> =
            login_email(client, "a@b.test".into(), "pw".into(), Uuid::nil()).await;
        let _: Result<opensecret::LoginResponse, AuthError> =
            login_guest_by_id(client, Uuid::nil(), "pw".into(), Uuid::nil()).await;
        let _: Result<opensecret::LoginResponse, AuthError> =
            register_guest(client, "pw".into(), Uuid::nil()).await;
        let _: Result<opensecret::LoginResponse, AuthError> =
            register_email(client, "a@b.test".into(), "pw".into(), Uuid::nil(), None).await;
        let _: Result<(), AuthError> = logout(client).await;
        let _: Result<(), AuthError> = refresh(client).await;
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-auth-opensecret`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/agicash-auth-opensecret
git commit -m "feat(auth-opensecret): add session wrappers (login/register/guest/logout/refresh)"
```

---

## Task 14: `agicash-auth-opensecret` — `KeyringSessionStorage` storing JSON blob

**Files:**
- Create: `crates/agicash-auth-opensecret/src/storage.rs`
- Modify: `crates/agicash-auth-opensecret/src/lib.rs`

Storage uses a single keyring entry whose password slot holds the JSON-serialized `PersistedSession`. Atomic: one entry per logical session, no risk of partial state (id-without-token or token-without-id).

- [ ] **Step 1: Write the failing tests**

Create `crates/agicash-auth-opensecret/src/storage.rs`:

```rust
use agicash_traits::{AuthError, PersistedSession, SessionStorage};
use async_trait::async_trait;

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn keyring_available() -> bool {
        if std::env::var("CI").is_ok() {
            return false;
        }
        #[cfg(target_os = "macos")]
        {
            true
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }

    #[tokio::test]
    async fn keyring_roundtrips_when_available() {
        if !keyring_available() {
            eprintln!("skipping: keyring unavailable in this environment");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}");
        let s = KeyringSessionStorage::new(&service);

        let _ = s.clear().await;

        assert!(s.load().await.unwrap().is_none());
        let session = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "test-refresh-token".to_string(),
        };
        s.store(&session).await.unwrap();
        let loaded = s.load().await.unwrap();
        assert_eq!(loaded, Some(session));
        s.clear().await.unwrap();
        assert!(s.load().await.unwrap().is_none());
    }
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Replace `crates/agicash-auth-opensecret/src/lib.rs`:

```rust
//! `KeyProvider` + `TokenProvider` impls over opensecret 0.2.9.

pub mod client;
pub mod config;
pub mod error;
pub mod session;
pub mod storage;

pub use client::*;
pub use config::*;
pub use session::*;
pub use storage::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-auth-opensecret`

Expected: FAIL — `KeyringSessionStorage` does not exist.

- [ ] **Step 4: Implement `KeyringSessionStorage`**

Replace `crates/agicash-auth-opensecret/src/storage.rs`:

```rust
use agicash_traits::{AuthError, PersistedSession, SessionStorage};
use async_trait::async_trait;

pub const DEFAULT_SERVICE: &str = "com.agicash.cli";
const SESSION_KEY: &str = "session";

#[derive(Debug, Clone)]
pub struct KeyringSessionStorage {
    service: String,
}

impl KeyringSessionStorage {
    #[must_use]
    pub fn new(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }

    fn entry(&self) -> Result<keyring::Entry, AuthError> {
        keyring::Entry::new(&self.service, SESSION_KEY)
            .map_err(|e| AuthError::Internal(format!("keyring entry: {e}")))
    }
}

impl Default for KeyringSessionStorage {
    fn default() -> Self {
        Self::new(DEFAULT_SERVICE)
    }
}

#[async_trait]
impl SessionStorage for KeyringSessionStorage {
    async fn store(&self, session: &PersistedSession) -> Result<(), AuthError> {
        let entry = self.entry()?;
        let blob = serde_json::to_string(session)
            .map_err(|e| AuthError::Internal(format!("serialize session: {e}")))?;
        tokio::task::spawn_blocking(move || entry.set_password(&blob))
            .await
            .map_err(|e| AuthError::Internal(format!("spawn_blocking: {e}")))?
            .map_err(|e| AuthError::Internal(format!("keyring set: {e}")))
    }

    async fn load(&self) -> Result<Option<PersistedSession>, AuthError> {
        let entry = self.entry()?;
        let result =
            tokio::task::spawn_blocking(move || entry.get_password())
                .await
                .map_err(|e| AuthError::Internal(format!("spawn_blocking: {e}")))?;
        match result {
            Ok(blob) => {
                let session = serde_json::from_str::<PersistedSession>(&blob)
                    .map_err(|e| AuthError::Internal(format!("deserialize session: {e}")))?;
                Ok(Some(session))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AuthError::Internal(format!("keyring get: {e}"))),
        }
    }

    async fn clear(&self) -> Result<(), AuthError> {
        let entry = self.entry()?;
        let result =
            tokio::task::spawn_blocking(move || entry.delete_credential())
                .await
                .map_err(|e| AuthError::Internal(format!("spawn_blocking: {e}")))?;
        match result {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AuthError::Internal(format!("keyring delete: {e}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn keyring_available() -> bool {
        if std::env::var("CI").is_ok() {
            return false;
        }
        #[cfg(target_os = "macos")]
        {
            true
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }

    #[tokio::test]
    async fn keyring_roundtrips_when_available() {
        if !keyring_available() {
            eprintln!("skipping: keyring unavailable in this environment");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}");
        let s = KeyringSessionStorage::new(&service);

        let _ = s.clear().await;

        assert!(s.load().await.unwrap().is_none());
        let session = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "test-refresh-token".to_string(),
        };
        s.store(&session).await.unwrap();
        let loaded = s.load().await.unwrap();
        assert_eq!(loaded, Some(session));
        s.clear().await.unwrap();
        assert!(s.load().await.unwrap().is_none());
    }
}
```

Note on the `keyring` 3.x API: method names like `delete_credential` and the `NoEntry` variant come from `keyring 3.x`. If the exact names differ (e.g., `delete_password` for older 2.x style), the executor must check `cargo doc --open -p keyring` or the crate's docs.rs page and adjust. The semantics are the same.

- [ ] **Step 5: Run tests — expect pass (or graceful skip on Linux/CI)**

Run: `cd crates && cargo test -p agicash-auth-opensecret`

Expected: PASS — keyring test passes on macOS; prints "skipping" on Linux/CI and still counts as a pass.

- [ ] **Step 6: Commit**

```bash
git add crates/agicash-auth-opensecret
git commit -m "feat(auth-opensecret): add KeyringSessionStorage storing JSON PersistedSession"
```

---

## Task 15: `agicash-auth-opensecret` — `OpenSecretKeyProvider`

**Files:**
- Create: `crates/agicash-auth-opensecret/src/key_provider.rs`
- Modify: `crates/agicash-auth-opensecret/src/lib.rs`

- [ ] **Step 1: Write failing compile-only tests**

Create `crates/agicash-auth-opensecret/src/key_provider.rs`:

```rust
use crate::OpenSecretClient;
use agicash_crypto::{Mnemonic, PublicKey, SecretKey, Signature, SigningAlgorithm};
use agicash_traits::{AuthError, KeyOptions, KeyProvider};
use async_trait::async_trait;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_options_converts_to_opensecret() {
        let ours = KeyOptions {
            private_key_derivation_path: Some("m/0'/0".into()),
            seed_phrase_derivation_path: Some("m/44'/0'/0'".into()),
        };
        let theirs: opensecret::KeyOptions = ours.into();
        assert_eq!(theirs.private_key_derivation_path.as_deref(), Some("m/0'/0"));
        assert_eq!(
            theirs.seed_phrase_derivation_path.as_deref(),
            Some("m/44'/0'/0'")
        );
    }

    #[test]
    fn signing_algorithm_converts_to_opensecret() {
        let s: opensecret::SigningAlgorithm = SigningAlgorithm::Schnorr.into();
        let _ = matches!(s, opensecret::SigningAlgorithm::Schnorr);
    }

    #[allow(dead_code)]
    async fn _provider_satisfies_trait(client: OpenSecretClient) {
        let p = OpenSecretKeyProvider::new(client);
        let _: Result<SecretKey, AuthError> =
            p.derive_private_key(KeyOptions::default()).await;
        let _: Result<PublicKey, AuthError> = p
            .derive_public_key(SigningAlgorithm::Schnorr, KeyOptions::default())
            .await;
        let _: Result<Signature, AuthError> = p
            .sign_message(b"hi", SigningAlgorithm::Schnorr, KeyOptions::default())
            .await;
        let _: Result<Mnemonic, AuthError> = p.get_mnemonic().await;
    }
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Replace `crates/agicash-auth-opensecret/src/lib.rs`:

```rust
//! `KeyProvider` + `TokenProvider` impls over opensecret 0.2.9.

pub mod client;
pub mod config;
pub mod error;
pub mod key_provider;
pub mod session;
pub mod storage;

pub use client::*;
pub use config::*;
pub use key_provider::*;
pub use session::*;
pub use storage::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-auth-opensecret`

Expected: FAIL — `OpenSecretKeyProvider` and the `From` conversions do not exist.

- [ ] **Step 4: Implement the conversions and the provider**

Replace `crates/agicash-auth-opensecret/src/key_provider.rs`:

```rust
use crate::OpenSecretClient;
use agicash_crypto::{Mnemonic, PublicKey, SecretKey, Signature, SigningAlgorithm};
use agicash_traits::{AuthError, KeyOptions, KeyProvider};
use async_trait::async_trait;

impl From<KeyOptions> for opensecret::KeyOptions {
    fn from(ours: KeyOptions) -> Self {
        opensecret::KeyOptions {
            private_key_derivation_path: ours.private_key_derivation_path,
            seed_phrase_derivation_path: ours.seed_phrase_derivation_path,
        }
    }
}

impl From<SigningAlgorithm> for opensecret::SigningAlgorithm {
    fn from(a: SigningAlgorithm) -> Self {
        match a {
            SigningAlgorithm::Schnorr => opensecret::SigningAlgorithm::Schnorr,
            SigningAlgorithm::Ecdsa => opensecret::SigningAlgorithm::Ecdsa,
        }
    }
}

#[derive(Debug, Clone)]
pub struct OpenSecretKeyProvider {
    client: OpenSecretClient,
}

impl OpenSecretKeyProvider {
    #[must_use]
    pub fn new(client: OpenSecretClient) -> Self {
        Self { client }
    }
}

#[async_trait]
impl KeyProvider for OpenSecretKeyProvider {
    async fn derive_private_key(&self, options: KeyOptions) -> Result<SecretKey, AuthError> {
        self.client.ensure_handshake().await?;
        let resp = self
            .client
            .inner()
            .get_private_key_bytes(Some(options.into()))
            .await
            .map_err(AuthError::from)?;
        SecretKey::try_from_hex(&resp.private_key)
            .map_err(|e| AuthError::Backend(format!("decode private_key: {e}")))
    }

    async fn derive_public_key(
        &self,
        algorithm: SigningAlgorithm,
        options: KeyOptions,
    ) -> Result<PublicKey, AuthError> {
        self.client.ensure_handshake().await?;
        let resp = self
            .client
            .inner()
            .get_public_key(algorithm.into(), Some(options.into()))
            .await
            .map_err(AuthError::from)?;
        let bytes = hex::decode(&resp.public_key)
            .map_err(|e| AuthError::Backend(format!("decode public_key: {e}")))?;
        Ok(PublicKey::new(bytes, algorithm))
    }

    async fn sign_message(
        &self,
        message: &[u8],
        algorithm: SigningAlgorithm,
        options: KeyOptions,
    ) -> Result<Signature, AuthError> {
        self.client.ensure_handshake().await?;
        let resp = self
            .client
            .inner()
            .sign_message(message, algorithm.into(), Some(options.into()))
            .await
            .map_err(AuthError::from)?;
        let bytes = hex::decode(&resp.signature)
            .map_err(|e| AuthError::Backend(format!("decode signature: {e}")))?;
        Ok(Signature::new(bytes, algorithm))
    }

    async fn get_mnemonic(&self) -> Result<Mnemonic, AuthError> {
        self.client.ensure_handshake().await?;
        let resp = self
            .client
            .inner()
            .get_private_key(None)
            .await
            .map_err(AuthError::from)?;
        Mnemonic::parse(&resp.mnemonic).map_err(|e| AuthError::Backend(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_options_converts_to_opensecret() {
        let ours = KeyOptions {
            private_key_derivation_path: Some("m/0'/0".into()),
            seed_phrase_derivation_path: Some("m/44'/0'/0'".into()),
        };
        let theirs: opensecret::KeyOptions = ours.into();
        assert_eq!(theirs.private_key_derivation_path.as_deref(), Some("m/0'/0"));
        assert_eq!(
            theirs.seed_phrase_derivation_path.as_deref(),
            Some("m/44'/0'/0'")
        );
    }

    #[test]
    fn signing_algorithm_converts_to_opensecret() {
        let s: opensecret::SigningAlgorithm = SigningAlgorithm::Schnorr.into();
        let _ = matches!(s, opensecret::SigningAlgorithm::Schnorr);
    }

    #[allow(dead_code)]
    async fn _provider_satisfies_trait(client: OpenSecretClient) {
        let p = OpenSecretKeyProvider::new(client);
        let _: Result<SecretKey, AuthError> =
            p.derive_private_key(KeyOptions::default()).await;
        let _: Result<PublicKey, AuthError> = p
            .derive_public_key(SigningAlgorithm::Schnorr, KeyOptions::default())
            .await;
        let _: Result<Signature, AuthError> = p
            .sign_message(b"hi", SigningAlgorithm::Schnorr, KeyOptions::default())
            .await;
        let _: Result<Mnemonic, AuthError> = p.get_mnemonic().await;
    }
}
```

Verify before implementing: open `~/agicash/node_modules/@agicash/opensecret-sdk/rust/src/lib.rs` (or the crate root) and confirm the field names `KeyOptions.private_key_derivation_path`, `KeyOptions.seed_phrase_derivation_path`, `SigningAlgorithm::{Schnorr,Ecdsa}`, `PrivateKeyBytesResponse.private_key`, `PrivateKeyResponse.mnemonic`, `PublicKeyResponse.public_key`, `SignMessageResponse.signature` match the research report exactly. If any differ, adjust the field accesses above before running tests.

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-auth-opensecret`

Expected: PASS — compile-only tests pass; real-network behavior is covered by the CLI integration test.

- [ ] **Step 6: Commit**

```bash
git add crates/agicash-auth-opensecret
git commit -m "feat(auth-opensecret): add OpenSecretKeyProvider implementing KeyProvider"
```

---

## Task 16: `agicash-auth-opensecret` — `OpenSecretTokenProvider`

**Files:**
- Create: `crates/agicash-auth-opensecret/src/token_provider.rs`
- Modify: `crates/agicash-auth-opensecret/src/lib.rs`

- [ ] **Step 1: Write the failing compile-only test**

Create `crates/agicash-auth-opensecret/src/token_provider.rs`:

```rust
use crate::OpenSecretClient;
use agicash_traits::{AuthError, TokenProvider};
use async_trait::async_trait;

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(dead_code)]
    async fn _provider_satisfies_trait(client: OpenSecretClient) {
        let p = OpenSecretTokenProvider::new(client);
        let _: Result<String, AuthError> = p.get_jwt().await;
    }
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Replace `crates/agicash-auth-opensecret/src/lib.rs`:

```rust
//! `KeyProvider` + `TokenProvider` impls over opensecret 0.2.9.

pub mod client;
pub mod config;
pub mod error;
pub mod key_provider;
pub mod session;
pub mod storage;
pub mod token_provider;

pub use client::*;
pub use config::*;
pub use key_provider::*;
pub use session::*;
pub use storage::*;
pub use token_provider::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-auth-opensecret`

Expected: FAIL — `OpenSecretTokenProvider` does not exist.

- [ ] **Step 4: Implement the provider**

Replace `crates/agicash-auth-opensecret/src/token_provider.rs`:

```rust
use crate::OpenSecretClient;
use agicash_traits::{AuthError, TokenProvider};
use async_trait::async_trait;

#[derive(Debug, Clone)]
pub struct OpenSecretTokenProvider {
    client: OpenSecretClient,
}

impl OpenSecretTokenProvider {
    #[must_use]
    pub fn new(client: OpenSecretClient) -> Self {
        Self { client }
    }
}

#[async_trait]
impl TokenProvider for OpenSecretTokenProvider {
    async fn get_jwt(&self) -> Result<String, AuthError> {
        self.client.ensure_handshake().await?;
        let resp = self
            .client
            .inner()
            .generate_third_party_token(None)
            .await
            .map_err(AuthError::from)?;
        Ok(resp.token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(dead_code)]
    async fn _provider_satisfies_trait(client: OpenSecretClient) {
        let p = OpenSecretTokenProvider::new(client);
        let _: Result<String, AuthError> = p.get_jwt().await;
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-auth-opensecret`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/agicash-auth-opensecret
git commit -m "feat(auth-opensecret): add OpenSecretTokenProvider implementing TokenProvider"
```

---

## Task 17: `agicash-cli` — add `auth` subcommand tree to clap (no whoami)

**Files:**
- Modify: `crates/agicash-cli/src/cli.rs`

`whoami` is dropped per gudnuf — `auth status` carries the load.

- [ ] **Step 1: Write the failing unit tests**

Append to `crates/agicash-cli/src/cli.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn parses_auth_guest() {
        let cli = Cli::try_parse_from(["agicash", "auth", "guest"]).unwrap();
        match cli.cmd {
            Some(Command::Auth(a)) => assert!(matches!(a.cmd, AuthCommand::Guest)),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_auth_login_with_email() {
        let cli = Cli::try_parse_from(["agicash", "auth", "login", "alice@example.com"]).unwrap();
        match cli.cmd {
            Some(Command::Auth(a)) => match a.cmd {
                AuthCommand::Login { email } => assert_eq!(email, "alice@example.com"),
                other => panic!("unexpected auth subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_auth_logout() {
        let cli = Cli::try_parse_from(["agicash", "auth", "logout"]).unwrap();
        match cli.cmd {
            Some(Command::Auth(a)) => assert!(matches!(a.cmd, AuthCommand::Logout)),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_auth_status() {
        let cli = Cli::try_parse_from(["agicash", "auth", "status"]).unwrap();
        match cli.cmd {
            Some(Command::Auth(a)) => assert!(matches!(a.cmd, AuthCommand::Status)),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn does_not_recognize_whoami() {
        let res = Cli::try_parse_from(["agicash", "whoami"]);
        assert!(res.is_err(), "whoami should NOT be a recognized subcommand");
    }
}
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-cli --lib`

Expected: FAIL — `AuthCommand` and `Command::Auth` do not exist.

- [ ] **Step 3: Implement the subcommand types**

Replace `crates/agicash-cli/src/cli.rs`:

```rust
use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(
    name = "agicash",
    version,
    about = "Agicash CLI — self-custody Bitcoin wallet"
)]
pub struct Cli {
    /// Output as JSON instead of human-readable text.
    #[arg(long, global = true)]
    pub json: bool,

    #[command(subcommand)]
    pub cmd: Option<Command>,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Print the SDK version.
    Version,
    /// Authentication and session management.
    Auth(AuthArgs),
}

#[derive(clap::Args, Debug)]
pub struct AuthArgs {
    #[command(subcommand)]
    pub cmd: AuthCommand,
}

#[derive(Subcommand, Debug)]
pub enum AuthCommand {
    /// Sign in with an email and password (password prompted on stdin).
    Login {
        /// Email address.
        email: String,
    },
    /// Register and sign in as an anonymous guest user.
    Guest,
    /// Clear the local session.
    Logout,
    /// Report whether a session is active, and if so, the user id.
    Status,
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn parses_auth_guest() {
        let cli = Cli::try_parse_from(["agicash", "auth", "guest"]).unwrap();
        match cli.cmd {
            Some(Command::Auth(a)) => assert!(matches!(a.cmd, AuthCommand::Guest)),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_auth_login_with_email() {
        let cli = Cli::try_parse_from(["agicash", "auth", "login", "alice@example.com"]).unwrap();
        match cli.cmd {
            Some(Command::Auth(a)) => match a.cmd {
                AuthCommand::Login { email } => assert_eq!(email, "alice@example.com"),
                other => panic!("unexpected auth subcommand: {other:?}"),
            },
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_auth_logout() {
        let cli = Cli::try_parse_from(["agicash", "auth", "logout"]).unwrap();
        match cli.cmd {
            Some(Command::Auth(a)) => assert!(matches!(a.cmd, AuthCommand::Logout)),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_auth_status() {
        let cli = Cli::try_parse_from(["agicash", "auth", "status"]).unwrap();
        match cli.cmd {
            Some(Command::Auth(a)) => assert!(matches!(a.cmd, AuthCommand::Status)),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn does_not_recognize_whoami() {
        let res = Cli::try_parse_from(["agicash", "whoami"]);
        assert!(res.is_err(), "whoami should NOT be a recognized subcommand");
    }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-cli --lib`

Expected: PASS — 5 new parser tests pass; existing slice-1 `help.rs` integration tests still pass too.

- [ ] **Step 5: Commit**

```bash
git add crates/agicash-cli/src/cli.rs
git commit -m "feat(cli): add Auth subcommand tree (login/guest/logout/status)"
```

---

## Task 18: `agicash-cli` — composition root + `.env` loading in main

**Files:**
- Modify: `crates/agicash-cli/Cargo.toml`
- Create: `crates/agicash-cli/src/composition.rs`
- Modify: `crates/agicash-cli/src/main.rs`

- [ ] **Step 1: Update the crate manifest**

Replace `crates/agicash-cli/Cargo.toml`:

```toml
[package]
name = "agicash-cli"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[[bin]]
name = "agicash"
path = "src/main.rs"

[features]
default = []
# Enable integration tests that hit the real Open Secret dev environment.
real-opensecret-tests = []

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-money = { path = "../agicash-money" }
agicash-traits = { path = "../agicash-traits" }
agicash-auth-opensecret = { path = "../agicash-auth-opensecret" }
agicash-wallet = { path = "../agicash-wallet" }
clap = { workspace = true }
tokio = { workspace = true }
rpassword = { workspace = true }
uuid = { workspace = true }
hex = { workspace = true }
dotenvy = { workspace = true }

[dev-dependencies]
assert_cmd = { workspace = true }
predicates = { workspace = true }
dotenvy = { workspace = true }

[lints]
workspace = true
```

- [ ] **Step 2: Create the composition module**

Create `crates/agicash-cli/src/composition.rs`:

```rust
use agicash_auth_opensecret::{KeyringSessionStorage, OpenSecretClient, OpenSecretConfig, DEFAULT_SERVICE};
use agicash_traits::AuthError;

#[derive(Debug, Clone)]
pub struct AuthDeps {
    pub client: OpenSecretClient,
    pub storage: KeyringSessionStorage,
}

pub fn build_auth_deps() -> Result<AuthDeps, AuthError> {
    let config = OpenSecretConfig::from_env()?;
    let client = OpenSecretClient::new(config)?;
    let service = std::env::var("AGICASH_KEYRING_SERVICE")
        .unwrap_or_else(|_| DEFAULT_SERVICE.to_string());
    let storage = KeyringSessionStorage::new(service);
    Ok(AuthDeps { client, storage })
}
```

- [ ] **Step 3: Wire `.env` loading and the module into `main.rs`**

Replace `crates/agicash-cli/src/main.rs`:

```rust
mod cli;
mod composition;

use clap::Parser;
use cli::{Cli, Command};

#[tokio::main]
async fn main() {
    // Load .env from the current working directory (and walk upward).
    // Silent on failure: env vars set in the shell still win, and the
    // composition root reports a clear error if the values are missing
    // when an auth command is invoked.
    let _ = dotenvy::dotenv();

    let args = Cli::parse();
    match args.cmd {
        Some(Command::Version) => println!("{}", env!("CARGO_PKG_VERSION")),
        Some(Command::Auth(_)) => {
            // Real dispatch lands in Tasks 19-22.
            unimplemented!("auth dispatch wired in subsequent tasks");
        }
        None => {}
    }
}
```

- [ ] **Step 4: Verify the workspace builds**

Run: `cd crates && cargo build -p agicash-cli`

Expected: PASS — `cli.rs`, `composition.rs`, and `main.rs` compile together.

- [ ] **Step 5: Verify the existing CLI integration tests still pass**

Run: `cd crates && cargo test -p agicash-cli --test help`

Expected: PASS — Task 9's `help.rs` tests still pass.

- [ ] **Step 6: Commit**

```bash
git add crates/agicash-cli
git commit -m "feat(cli): add composition root + dotenvy .env loading in main"
```

---

## Task 19: `agicash-cli` — `auth guest` handler

**Files:**
- Create: `crates/agicash-cli/src/auth.rs`
- Modify: `crates/agicash-cli/src/main.rs`

- [ ] **Step 1: Create the auth module with `cmd_guest`**

Create `crates/agicash-cli/src/auth.rs`:

```rust
use crate::composition::AuthDeps;
use agicash_auth_opensecret::register_guest;
use agicash_traits::{AuthError, PersistedSession, SessionStorage};

fn random_password() -> String {
    // 16 random bytes => 32 hex chars of entropy from /dev/urandom.
    use std::io::Read;
    let mut buf = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        let _ = f.read_exact(&mut buf);
    } else {
        // Fallback for exotic platforms without urandom — very rare on
        // the platforms agicash CLI runs on (macOS/Linux).
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        for (i, b) in buf.iter_mut().enumerate() {
            *b = ((nanos >> (i % 16)) as u8) ^ (i as u8);
        }
    }
    hex::encode(buf)
}

pub async fn cmd_guest(deps: &AuthDeps) -> Result<(), AuthError> {
    let password = random_password();
    let resp = register_guest(&deps.client, password, deps.client.client_id()).await?;
    let session = PersistedSession {
        user_id: resp.id,
        refresh_token: resp.refresh_token.clone(),
    };
    deps.storage.store(&session).await?;
    println!("signed in as guest {}", resp.id);
    Ok(())
}
```

- [ ] **Step 2: Wire `auth.rs` into `main.rs`**

Replace `crates/agicash-cli/src/main.rs`:

```rust
mod auth;
mod cli;
mod composition;

use clap::Parser;
use cli::{AuthCommand, Cli, Command};
use composition::build_auth_deps;

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    let args = Cli::parse();
    let exit_code = match run(args).await {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("error: {e}");
            1
        }
    };
    std::process::exit(exit_code);
}

async fn run(args: Cli) -> Result<(), Box<dyn std::error::Error>> {
    match args.cmd {
        Some(Command::Version) => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Some(Command::Auth(a)) => match a.cmd {
            AuthCommand::Guest => {
                let deps = build_auth_deps()?;
                auth::cmd_guest(&deps).await?;
                Ok(())
            }
            AuthCommand::Login { .. } | AuthCommand::Logout | AuthCommand::Status => {
                unimplemented!("wired in later tasks");
            }
        },
        None => Ok(()),
    }
}
```

- [ ] **Step 3: CLI smoke test for `auth guest --help`**

Append to `crates/agicash-cli/tests/help.rs`:

```rust
#[test]
fn auth_guest_help_lists_command() {
    Command::cargo_bin("agicash")
        .unwrap()
        .args(["auth", "guest", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("guest"));
}
```

Run: `cd crates && cargo test -p agicash-cli --test help`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/agicash-cli
git commit -m "feat(cli): add 'auth guest' handler with PersistedSession persistence"
```

---

## Task 20: `agicash-cli` — `auth login` handler

**Files:**
- Modify: `crates/agicash-cli/src/auth.rs`
- Modify: `crates/agicash-cli/src/main.rs`

- [ ] **Step 1: Add `cmd_login`**

Append to `crates/agicash-cli/src/auth.rs`:

```rust
use agicash_auth_opensecret::login_email;

pub async fn cmd_login(deps: &AuthDeps, email: String) -> Result<(), AuthError> {
    let password = rpassword::prompt_password("Password: ")
        .map_err(|e| AuthError::Internal(format!("read password: {e}")))?;
    let resp = login_email(&deps.client, email, password, deps.client.client_id()).await?;
    let session = PersistedSession {
        user_id: resp.id,
        refresh_token: resp.refresh_token.clone(),
    };
    deps.storage.store(&session).await?;
    println!("signed in as {}", resp.id);
    Ok(())
}
```

- [ ] **Step 2: Wire into `main.rs`**

In `crates/agicash-cli/src/main.rs`, update the `AuthCommand::Login` arm:

```rust
AuthCommand::Login { email } => {
    let deps = build_auth_deps()?;
    auth::cmd_login(&deps, email).await?;
    Ok(())
}
```

(Replace the existing `| Login { .. }` from Task 19's catch-all with this dedicated arm.)

- [ ] **Step 3: CLI smoke test**

Append to `crates/agicash-cli/tests/help.rs`:

```rust
#[test]
fn auth_login_help_requires_email_arg() {
    Command::cargo_bin("agicash")
        .unwrap()
        .args(["auth", "login", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("email"));
}
```

Run: `cd crates && cargo test -p agicash-cli --test help`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/agicash-cli
git commit -m "feat(cli): add 'auth login' handler with rpassword prompt"
```

---

## Task 21: `agicash-cli` — `auth logout` handler

**Files:**
- Modify: `crates/agicash-cli/src/auth.rs`
- Modify: `crates/agicash-cli/src/main.rs`

- [ ] **Step 1: Add `cmd_logout`**

Append to `crates/agicash-cli/src/auth.rs`:

```rust
use agicash_auth_opensecret::logout;

pub async fn cmd_logout(deps: &AuthDeps) -> Result<(), AuthError> {
    if deps.storage.load().await?.is_none() {
        println!("not logged in");
        return Ok(());
    }
    // Best-effort server logout. Even if the server call fails (e.g.,
    // network error or expired session), we clear local state so the
    // command is idempotent.
    if let Err(e) = logout(&deps.client).await {
        eprintln!("warning: server logout failed: {e}");
    }
    deps.storage.clear().await?;
    println!("signed out");
    Ok(())
}
```

- [ ] **Step 2: Wire into `main.rs`**

Update the `AuthCommand::Logout` arm:

```rust
AuthCommand::Logout => {
    let deps = build_auth_deps()?;
    auth::cmd_logout(&deps).await?;
    Ok(())
}
```

- [ ] **Step 3: Build check**

Run: `cd crates && cargo build -p agicash-cli`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/agicash-cli
git commit -m "feat(cli): add 'auth logout' handler that clears local session"
```

---

## Task 22: `agicash-cli` — `auth status` handler (prints user id)

**Files:**
- Modify: `crates/agicash-cli/src/auth.rs`
- Modify: `crates/agicash-cli/src/main.rs`

`status` is the slice-2 read path: it must print `logged in as <user_id>` when a session exists in the keyring, and `not logged in` otherwise. The user id comes from the persisted `PersistedSession.user_id` — no JWT decoding required. The integration test in Task 24 relies on this output format.

- [ ] **Step 1: Add `cmd_status`**

Append to `crates/agicash-cli/src/auth.rs`:

```rust
pub async fn cmd_status(deps: &AuthDeps) -> Result<(), AuthError> {
    match deps.storage.load().await? {
        None => {
            println!("not logged in");
        }
        Some(session) => {
            println!("logged in as {}", session.user_id);
        }
    }
    Ok(())
}
```

We deliberately do NOT call `refresh` here. The test bar is "persistence across process restart"; a stale token (expired on the server) still counts as "locally logged in" — `logout` is how you clear local state. If you want server-side liveness, run `auth login` again. This matches `gh auth status` UX.

- [ ] **Step 2: Wire into `main.rs`**

Update the `AuthCommand::Status` arm:

```rust
AuthCommand::Status => {
    let deps = build_auth_deps()?;
    auth::cmd_status(&deps).await?;
    Ok(())
}
```

- [ ] **Step 3: Build check**

Run: `cd crates && cargo build -p agicash-cli`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/agicash-cli
git commit -m "feat(cli): add 'auth status' handler printing user id from persisted session"
```

---

## Task 23: CLI integration test — session survives process restart

**Files:**
- Create: `crates/agicash-cli/tests/auth_lifecycle.rs`

The test sequence:

1. Process 1: `agicash auth guest` → capture user id from stdout.
2. Process 2 (fresh): `agicash auth status` → assert stdout contains "logged in" AND the same user id.
3. Process 3 (fresh): `agicash auth logout` → exit 0.
4. Process 4 (fresh): `agicash auth status` → assert stdout contains "not logged in".

This proves persistence without `whoami` — it's exactly the test bar from §16 ("tokens survive process restart") expressed through `status`.

- [ ] **Step 1: Write the integration test**

Create `crates/agicash-cli/tests/auth_lifecycle.rs`:

```rust
//! End-to-end auth lifecycle against the real Open Secret dev environment.
//!
//! Gated behind the `real-opensecret-tests` cargo feature so plain
//! `cargo test` stays hermetic. To run:
//!
//! ```
//! cargo test -p agicash-cli --features real-opensecret-tests --test auth_lifecycle -- --nocapture
//! ```
//!
//! Env vars are loaded from .env (the same way the CLI binary loads them):
//! - OPENSECRET_BASE_URL
//! - OPENSECRET_CLIENT_ID

use assert_cmd::Command;
use predicates::prelude::*;

fn env_ready() -> bool {
    let _ = dotenvy::dotenv();
    std::env::var("OPENSECRET_BASE_URL").is_ok()
        && std::env::var("OPENSECRET_CLIENT_ID").is_ok()
}

#[cfg(not(feature = "real-opensecret-tests"))]
#[test]
fn auth_lifecycle_skipped_without_feature() {
    eprintln!(
        "skipping real-opensecret-tests; run with: \
         cargo test -p agicash-cli --features real-opensecret-tests"
    );
}

#[cfg(feature = "real-opensecret-tests")]
#[test]
fn session_survives_process_restart() {
    if !env_ready() {
        eprintln!("skipping: OPENSECRET_BASE_URL and/or OPENSECRET_CLIENT_ID not set");
        return;
    }

    // Use a unique keyring service per test run so we don't collide with the
    // developer's normal CLI state and so tests are isolated.
    let pid = std::process::id();
    let service = format!("com.agicash.cli.test.{pid}");

    // Helper: each call spawns a *fresh* process. assert_cmd::Command does
    // not share state with the test process beyond env/args, which is
    // exactly what we want — the only carrier is the OS keyring entry.
    let make_cmd = || {
        let mut c = Command::cargo_bin("agicash").unwrap();
        c.env("AGICASH_KEYRING_SERVICE", &service);
        c
    };

    // Step 1: register a guest user.
    let guest_out = make_cmd()
        .args(["auth", "guest"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let guest_stdout = String::from_utf8(guest_out).unwrap();
    // cmd_guest output: "signed in as guest <uuid>"
    let guest_uuid = guest_stdout
        .split_whitespace()
        .last()
        .expect("guest stdout has uuid")
        .to_string();
    assert!(
        uuid::Uuid::parse_str(&guest_uuid).is_ok(),
        "expected guest uuid, got: {guest_stdout}"
    );

    // Step 2: fresh process, status must show the same uuid.
    make_cmd()
        .args(["auth", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("logged in"))
        .stdout(predicate::str::contains(&guest_uuid));

    // Step 3: logout (fresh process).
    make_cmd()
        .args(["auth", "logout"])
        .assert()
        .success();

    // Step 4: fresh process, status must report logged out.
    make_cmd()
        .args(["auth", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("not logged in"));
}
```

- [ ] **Step 2: Run the gated test (no feature → skip)**

Run: `cd crates && cargo test -p agicash-cli --test auth_lifecycle`

Expected: PASS — the `auth_lifecycle_skipped_without_feature` test runs and prints the skip message; no network calls.

- [ ] **Step 3: Run the real-network test (manual; reads `.env`)**

Confirm `~/agicash/.env` has `OPENSECRET_BASE_URL` and `OPENSECRET_CLIENT_ID` (gudnuf says it already does), then:

```bash
cd crates && \
cargo test -p agicash-cli --features real-opensecret-tests --test auth_lifecycle -- --nocapture
```

Expected: PASS — four subprocess invocations succeed, status outputs the same uuid as guest registration, post-logout status reports "not logged in".

If env vars aren't available, the test prints "skipping" and still passes.

- [ ] **Step 4: Commit**

```bash
git add crates/agicash-cli
git commit -m "$(cat <<'EOF'
test(cli): add auth lifecycle integration test

Spawns four fresh agicash processes (auth guest -> auth status ->
auth logout -> auth status) to verify the keyring-backed
PersistedSession survives process restart. Gated behind
real-opensecret-tests feature; reads .env via dotenvy.
EOF
)"
```

---

## Task 24: Final verification — the slice-2 test bar

This task confirms slice 2 is complete by running every check that matters.

- [ ] **Step 1: `cargo build` passes**

Run: `cd crates && cargo build --workspace`

Expected: PASS, no warnings.

- [ ] **Step 2: Default `cargo test` passes (hermetic — no network)**

Run: `cd crates && cargo test --workspace`

Expected: PASS — all slice-1 tests, all new crypto/traits/auth-opensecret/cli tests, and the gated lifecycle test (which prints a skip line) all succeed.

- [ ] **Step 3: `cargo clippy -- -D warnings` passes**

Run: `cd crates && cargo clippy --workspace --all-targets -- -D warnings`

Expected: PASS, no warnings. The handful of `#[allow(dead_code)]` markers we used on `_typecheck` helper async functions are intentional and clippy should accept them.

- [ ] **Step 4: `cargo fmt --check` passes**

Run: `cd crates && cargo fmt --all --check`

Expected: PASS, no diff.

- [ ] **Step 5: WASM target still builds**

Run: `cd crates && cargo build --target wasm32-unknown-unknown -p agicash-wasm`

Expected: PASS — auth slice did not touch the wasm crate and it must keep compiling.

- [ ] **Step 6: CLI surface matches plan**

Run: `cd crates && cargo run -p agicash-cli -- auth --help`

Expected output includes `login`, `guest`, `logout`, `status` subcommands. No `whoami`.

- [ ] **Step 7: Real-network manual verification (gated; uses `.env`)**

Assuming `~/agicash/.env` has `OPENSECRET_BASE_URL` and `OPENSECRET_CLIENT_ID`:

```bash
cd crates
export AGICASH_KEYRING_SERVICE=com.agicash.cli.local-verify

cargo run -p agicash-cli -- auth guest
# expected: "signed in as guest <uuid>"  -- copy the uuid

cargo run -p agicash-cli -- auth status
# expected: "logged in as <same uuid>"
# This proves the slice-2 test bar: session survives process restart.

cargo run -p agicash-cli -- auth logout
# expected: "signed out"

cargo run -p agicash-cli -- auth status
# expected: "not logged in"

# clean up the test keyring entry
security delete-generic-password -s com.agicash.cli.local-verify 2>/dev/null || true
```

If every line behaves as commented, slice 2 is functionally complete.

- [ ] **Step 8: Stop and report — DO NOT open a PR**

This is an experimental project. Per `~/athanor/projects/agicash-rust/PROCESS.md`, slices never get merged to master; branches stack. After Task 24 step 7 passes, report back to the meta-agent with:

- Full commit list (oldest first, `git log --oneline feat/rust-scaffold..feat/rust-auth | tac`)
- Output of every verification step in this task (steps 1-6)
- Any deviations from the plan and why
- Anything you noticed worth flagging for slice 3 or the spec

Do not push the branch. Do not open a PR. Do not merge anywhere.

After the meta-agent reviews and gudnuf signs off, slice 2 is done. The next plan to write is for **slice 3 — User + Accounts read path**.

---

## Notes for the executor

- **Do not open the PR yourself.** The meta-agent reviews each slice and opens the PR. After Task 24 step 8 is checked, stop and report.
- **Do not implement anything from slice 3+.** No `FakeKeyProvider` in `agicash-testing`, no `open_secret_fixture` shared cache, no account storage, no derived-key cache. Those land in their own slices.
- **`whoami` is deliberately omitted.** Spec §10 lists it; this slice drops it because `auth status` already prints the user id, and gudnuf decided we don't need a second command for the same data. Spec §10 should be updated to drop `whoami` after sign-off; the meta-agent handles that.
- **`.env` is loaded by `dotenvy::dotenv().ok()` as the first line of `main()`.** This means a developer with `OPENSECRET_BASE_URL` and `OPENSECRET_CLIENT_ID` in `~/agicash/.env` does not need to export them. The integration test calls `dotenvy::dotenv()` in its `env_ready()` helper for the same reason. Shell env vars still win over `.env`.
- **No private-key caching in this slice.** Each `derive_private_key` call hits opensecret. The §6 in-memory cache layer lands in slice 4 once a real consumer exists.
- **Verify opensecret API shapes before each implementation step.** The research report names exact methods and field names, but if any disagree with the actual 0.2.9 crate at `~/agicash/node_modules/@agicash/opensecret-sdk/rust/` or on crates.io, trust the source. Adjust the code, do not paper over with mismatched names that fail to compile.
- **The `unimplemented!()` pattern in Task 18 is a one-task scaffold.** Tasks 19-22 each replace one arm. Do not leave `unimplemented!()` in the final commit of any task after 18.
- **Type names from this slice are load-bearing in later slices.** `KeyProvider`, `TokenProvider`, `SessionStorage`, `PersistedSession`, `AuthError`, `KeyOptions`, `SecretKey`, `PublicKey`, `Signature`, `Mnemonic`, `SigningAlgorithm`, `OpenSecretClient`, `OpenSecretKeyProvider`, `OpenSecretTokenProvider`, `KeyringSessionStorage`, `OpenSecretConfig`. Renaming any requires updating the spec.
- **The CI workflow does not require the real-network feature.** `cargo test --workspace` on the runner skips the lifecycle test gracefully. We'll add a nightly job (with secrets) in a later slice.
- **`Cargo.lock`** continues to be committed (workspace has a binary crate). New deps will update the lockfile; let the commit that introduces each dep also touch the lock.
- **If keyring 3.x renamed methods** (`delete_credential` vs `delete_password`, `NoEntry` vs `NoEntryFound`), fix Task 14's impl. Same behavior; just rename the calls.
- **If clippy::pedantic complains about specific patterns** (e.g., `must_use_candidate`, `unnecessary_wraps`), check whether the workspace-level allow in `crates/Cargo.toml` already covers it. If not, prefer fixing the code over adding a new allow; raise it as an open question if the fix is unclear.
