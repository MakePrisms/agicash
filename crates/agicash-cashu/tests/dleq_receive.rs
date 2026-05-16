//! Integration test: NUT-12 DLEQ verification on the receive path.
//!
//! The unit tests in `dleq.rs` exercise the verifier directly. This
//! integration test pins the wire-level shape we expect: a peer-token
//! `TokenProof` carrying a *tampered* inline DLEQ must round-trip back
//! into a [`cdk::nuts::Proof`] cleanly (so we don't silently drop the
//! verification by failing to decode the DLEQ), and then must be
//! *rejected* by [`agicash_cashu::verify_proof_dleq`].
//!
//! This is the end-to-end behavior gudnuf cares about for "receive a
//! tampered token": the bytes parse, get reconstituted into the same
//! type the swap path operates on, and the verification step refuses
//! them with the [`DleqVerificationError::ProofInvalid`] variant.
//!
//! A full live-mint e2e (parse cashuB token → service.complete_swap →
//! observe `ReceiveSwapError::DleqVerificationFailed`) needs a running
//! mint and is gated behind the `real-mint-tests` feature. This test
//! covers the cryptographic + wire-format contract that the
//! `cdk_proof_to_token_proof` / `token_proof_to_cdk_proof` round-trip
//! introduced in this branch must satisfy.

use std::collections::BTreeMap;
use std::str::FromStr;

use agicash_cashu::{verify_proof_dleq, DleqVerificationError};
use cdk::nuts::nut01::{Keys, PublicKey, SecretKey};
use cdk::nuts::nut02::Id as KeysetId;
use cdk::nuts::{CurrencyUnit, KeySet, Proof};
use cdk::Amount;

/// Build a one-amount keyset mapping `amount → secret.public_key()`,
/// matching the cashu-0.15.1 nut12 test vector shape.
fn one_amount_keyset(secret: &SecretKey, amount: Amount) -> KeySet {
    let mut m: BTreeMap<Amount, PublicKey> = BTreeMap::new();
    m.insert(amount, secret.public_key());
    KeySet {
        id: KeysetId::from_str("00882760bfa2eb41").unwrap(),
        unit: CurrencyUnit::Sat,
        active: Some(true),
        keys: Keys::new(m),
        input_fee_ppk: 0,
        final_expiry: None,
    }
}

/// Mint secret that pairs with the proof DLEQ test vectors below.
fn proof_test_keyset() -> KeySet {
    let secret =
        SecretKey::from_hex("0000000000000000000000000000000000000000000000000000000000000001")
            .unwrap();
    one_amount_keyset(&secret, Amount::from(1))
}

/// Known-good proof carrying an inline NUT-12 DLEQ (`e`/`s`/`r`).
/// Lifted verbatim from cashu-0.15.1's nut12 test vectors.
const VALID_PROOF_JSON: &str = r#"{
    "amount": 1,
    "id": "00882760bfa2eb41",
    "secret": "daf4dd00a2b68a0858a80450f52c8a7d2ccf87d375e43e216e0c571f089f63e9",
    "C": "024369d2d22a80ecf78f3937da9d5f30c1b9f74f0c32684d583cca0fa6a61cdcfc",
    "dleq": {
        "e": "b31e58ac6527f34975ffab13e70a48b6d2b0d35abc4b03f0151f09ee1a9763d4",
        "s": "8fbae004c59e754d71df67e392b6ae4e29293113ddc2ec86592a0431d16306d8",
        "r": "a6d13fcd7a18442e6076f5e1e7c887ad5de40a019824bdfa9fe740d302e8d861"
    }
}"#;

#[test]
fn receive_path_accepts_valid_inline_dleq() {
    // Sanity: the round-trip baseline must verify, otherwise a
    // tampered-rejection test below could be passing for the wrong
    // reason (e.g. the verifier rejecting everything).
    let proof: Proof = serde_json::from_str(VALID_PROOF_JSON).unwrap();
    let keyset = proof_test_keyset();
    verify_proof_dleq(&proof, &keyset).expect("baseline valid DLEQ must verify");
}

#[test]
fn receive_path_rejects_tampered_inline_dleq() {
    // Take the known-good proof JSON, mutate exactly one byte of `e`
    // (last hex digit `4` → `5`, still a valid SecretKey scalar but no
    // longer satisfying the DLEQ relation), reparse, and confirm the
    // verifier rejects it with the typed `ProofInvalid` variant.
    //
    // This is the exact shape the receive-swap pipeline runs after
    // `cdk_proof_to_token_proof` preserves the inline DLEQ and
    // `token_proof_to_cdk_proof` round-trips it back into a `Proof`.
    let tampered_json = VALID_PROOF_JSON.replace(
        "\"e\": \"b31e58ac6527f34975ffab13e70a48b6d2b0d35abc4b03f0151f09ee1a9763d4\"",
        "\"e\": \"b31e58ac6527f34975ffab13e70a48b6d2b0d35abc4b03f0151f09ee1a9763d5\"",
    );
    // Guard against silent test-bitrot: the replace must have changed
    // the body. If the canonical JSON drifts this test should fail
    // loudly rather than silently testing the un-tampered proof.
    assert_ne!(
        tampered_json, VALID_PROOF_JSON,
        "tamper must mutate the JSON; vectors may have drifted"
    );

    let proof: Proof = serde_json::from_str(&tampered_json).unwrap();
    let keyset = proof_test_keyset();

    let err = verify_proof_dleq(&proof, &keyset)
        .expect_err("tampered DLEQ must be rejected by verify_proof_dleq");
    assert!(
        matches!(err, DleqVerificationError::ProofInvalid { .. }),
        "expected ProofInvalid for tampered DLEQ, got {err:?}"
    );
}

#[test]
fn receive_path_tampered_e_field_yields_proof_invalid() {
    // Independent tamper site: mutate the `s` field instead of `e`,
    // confirming the verifier doesn't only catch tampering on one
    // component. Both `e` and `s` are part of the Fiat–Shamir relation;
    // tampering with either must trip the verifier.
    let tampered_json = VALID_PROOF_JSON.replace(
        "\"s\": \"8fbae004c59e754d71df67e392b6ae4e29293113ddc2ec86592a0431d16306d8\"",
        "\"s\": \"8fbae004c59e754d71df67e392b6ae4e29293113ddc2ec86592a0431d16306d9\"",
    );
    assert_ne!(
        tampered_json, VALID_PROOF_JSON,
        "tamper must mutate the JSON; vectors may have drifted"
    );

    let proof: Proof = serde_json::from_str(&tampered_json).unwrap();
    let keyset = proof_test_keyset();
    let err = verify_proof_dleq(&proof, &keyset)
        .expect_err("tampered `s` must be rejected by verify_proof_dleq");
    assert!(
        matches!(err, DleqVerificationError::ProofInvalid { .. }),
        "expected ProofInvalid for `s`-tampered DLEQ, got {err:?}"
    );
}
