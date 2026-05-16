//! Integration test: NUT-08 melt change reconstruction with sigs
//! returned out of order or with one missing DLEQ.
//!
//! These tests pin the behavior of the trial-match-by-DLEQ-reblind
//! matcher (`match_blind_signatures_to_pre_mints`) on the melt change
//! path. The matcher exists because both CDK and Nutshell read change
//! rows from SQL without `ORDER BY` (see
//! <https://github.com/cashubtc/cashu-ts/issues/287>), so positional
//! pairing of sigs to blanks silently breaks under reordering.
//!
//! Both tests would FAIL against the prior positional implementation
//! (`construct_change_proofs` at HEAD `d4f53148`): the first because
//! every DLEQ verify would fail against the wrong blinding factor; the
//! second because a positional pair would happily unblind a sig with no
//! DLEQ and ship a proof with `dleq: None` (the operator's stricter
//! Option-A semantics require fail-closed on the change path).

use std::collections::BTreeMap;
use std::str::FromStr;

use agicash_cashu::{match_blind_signatures_to_pre_mints, DleqVerificationError};
use cdk::dhke::{blind_message, construct_proofs, sign_message};
use cdk::nuts::nut01::{Keys, PublicKey, SecretKey};
use cdk::nuts::nut02::Id as KeysetId;
use cdk::nuts::{BlindSignature, BlindedMessage, CurrencyUnit, KeySet, PreMint, PreMintSecrets};
use cdk::secret::Secret;
use cdk::Amount;

/// Fixed test keyset id so signatures match `KeySet.id`.
const KEYSET_ID_HEX: &str = "00882760bfa2eb41";

/// Build a multi-amount keyset where every amount maps to the same
/// `mint_secret`. We don't need power-of-two amount distribution for the
/// matcher tests — what matters is that every `sig.amount` resolves to
/// the same pubkey we'll sign against.
fn one_secret_keyset(mint_secret: &SecretKey, amounts: &[Amount]) -> KeySet {
    let mut keys: BTreeMap<Amount, PublicKey> = BTreeMap::new();
    for amt in amounts {
        keys.insert(*amt, mint_secret.public_key());
    }
    KeySet {
        id: KeysetId::from_str(KEYSET_ID_HEX).unwrap(),
        unit: CurrencyUnit::Sat,
        active: Some(true),
        keys: Keys::new(keys),
        input_fee_ppk: 0,
        final_expiry: None,
    }
}

/// Build a single change blank with a deterministic test secret seed.
/// Returns the `PreMint` (caller pushes it into a `PreMintSecrets`).
fn build_blank(keyset_id: KeysetId, secret_seed: u8) -> PreMint {
    // Deterministic 32-byte secret from a single seed byte so tests are
    // reproducible without an RNG dependency.
    let secret_bytes = [secret_seed; 32];
    let secret = Secret::new(hex::encode(secret_bytes));
    let (blinded, r) =
        blind_message(secret.as_bytes(), None).expect("blind_message on seeded secret");
    PreMint {
        blinded_message: BlindedMessage::new(Amount::ZERO, keyset_id, blinded),
        secret,
        r,
        amount: Amount::ZERO,
    }
}

/// Simulate a NUT-08 mint signing a single change blank. The mint
/// picks the amount, signs `blinded_message.blinded_secret`, attaches a
/// NUT-12 DLEQ.
fn mint_sign_change(
    mint_secret: &SecretKey,
    keyset_id: KeysetId,
    blank: &PreMint,
    amount_assigned: Amount,
) -> BlindSignature {
    let blinded_signature =
        sign_message(mint_secret, &blank.blinded_message.blinded_secret).expect("sign_message");
    BlindSignature::new(
        amount_assigned,
        blinded_signature,
        keyset_id,
        &blank.blinded_message.blinded_secret,
        mint_secret.clone(),
    )
    .expect("BlindSignature::new with DLEQ")
}

#[test]
fn matcher_pairs_correctly_when_sigs_are_shuffled() {
    // N=5 blanks, M=5 sigs in DELIBERATELY shuffled order, each amount
    // distinct so we can assert the right (sig, blank) pairing survived
    // by checking the unblinded proof's amount per its source blank.
    let mint_secret =
        SecretKey::from_hex("0000000000000000000000000000000000000000000000000000000000000001")
            .unwrap();
    let keyset_id = KeysetId::from_str(KEYSET_ID_HEX).unwrap();
    let amounts = [
        Amount::from(1),
        Amount::from(2),
        Amount::from(4),
        Amount::from(8),
        Amount::from(16),
    ];
    let keyset = one_secret_keyset(&mint_secret, &amounts);

    // 5 deterministic blanks with distinguishable secret seeds.
    let mut pre_mints = PreMintSecrets::new(keyset_id);
    for seed in 0..5u8 {
        pre_mints.secrets.push(build_blank(keyset_id, seed + 1));
    }
    assert_eq!(pre_mints.len(), 5);

    // Mint signs each blank with a distinct amount (in send order).
    let in_order_sigs: Vec<BlindSignature> = pre_mints
        .secrets
        .iter()
        .zip(amounts.iter())
        .map(|(blank, amt)| mint_sign_change(&mint_secret, keyset_id, blank, *amt))
        .collect();

    // Shuffle: reverse-then-swap. This is *not* a valid positional
    // pairing — sigs[0] now corresponds to blank[4], etc. A purely
    // positional `construct_proofs` would feed (sig_for_blank_4,
    // r_for_blank_0, secret_for_blank_0) and the unblinding would
    // produce a `C` that fails to verify against either DLEQ.
    let shuffled: Vec<BlindSignature> = vec![
        in_order_sigs[4].clone(), // blank 4
        in_order_sigs[2].clone(), // blank 2
        in_order_sigs[0].clone(), // blank 0
        in_order_sigs[3].clone(), // blank 3
        in_order_sigs[1].clone(), // blank 1
    ];

    let matched = match_blind_signatures_to_pre_mints(&shuffled, &pre_mints, &keyset)
        .expect("matcher must succeed against shuffled-but-valid sigs");

    assert_eq!(matched.signatures.len(), 5, "all 5 sigs must be matched");
    assert_eq!(matched.pre_mints.len(), 5, "all 5 blanks must be matched");

    // Reconstruct proofs from the matched pairs the same way the
    // production path does. The (sig, r, secret) triples must align.
    let rs = matched.rs();
    let secrets = matched.secrets();
    let proofs = construct_proofs(matched.signatures.clone(), rs, secrets, &keyset.keys)
        .expect("construct_proofs over matched triples");

    // Verify each output proof's amount matches the shuffled-order sig
    // amount AND that the DLEQ check on the proof succeeds (it must,
    // because the matcher verified DLEQ on the blind sig; this is the
    // post-unblind end-to-end check).
    for (i, proof) in proofs.iter().enumerate() {
        assert_eq!(
            proof.amount, shuffled[i].amount,
            "proof[{i}] amount must match the matched sig's amount",
        );
        // The PreMint we matched must be the one whose original sig had
        // the same amount as the shuffled sig — i.e., matched.pre_mints[i]
        // is the original blank whose unblinding yields this proof.
        // Re-derive the per-amount mint pubkey to verify the DLEQ end-to-end.
        let mint_pubkey = keyset.keys.amount_key(proof.amount).expect("amount key");
        proof
            .verify_dleq(mint_pubkey)
            .expect("post-unblind DLEQ on each proof must verify");
    }

    // Map sig -> blank: shuffled[0] originally signed blank[4], etc.
    // Validate the matcher actually paired sigs to the *right* blanks by
    // comparing secrets.
    let expected_blank_order = [4, 2, 0, 3, 1];
    for (i, &expected_idx) in expected_blank_order.iter().enumerate() {
        assert_eq!(
            matched.pre_mints[i].secret, pre_mints.secrets[expected_idx].secret,
            "matched.pre_mints[{i}] must be original blank index {expected_idx}",
        );
    }
}

#[test]
fn matcher_fails_closed_when_any_sig_lacks_dleq() {
    // Build 3 blanks, sign 3 valid sigs, then strip the DLEQ off the
    // middle one. The matcher must refuse the entire batch (Option-A
    // semantics from the audit: change-path requires NUT-12).
    let mint_secret =
        SecretKey::from_hex("0000000000000000000000000000000000000000000000000000000000000001")
            .unwrap();
    let keyset_id = KeysetId::from_str(KEYSET_ID_HEX).unwrap();
    let amounts = [Amount::from(1), Amount::from(2), Amount::from(4)];
    let keyset = one_secret_keyset(&mint_secret, &amounts);

    let mut pre_mints = PreMintSecrets::new(keyset_id);
    for seed in 10..13u8 {
        pre_mints.secrets.push(build_blank(keyset_id, seed));
    }

    let mut sigs: Vec<BlindSignature> = pre_mints
        .secrets
        .iter()
        .zip(amounts.iter())
        .map(|(blank, amt)| mint_sign_change(&mint_secret, keyset_id, blank, *amt))
        .collect();

    // Strip the DLEQ from the second sig — simulates a mint that only
    // partially advertises NUT-12 on the change path.
    sigs[1].dleq = None;

    let err = match_blind_signatures_to_pre_mints(&sigs, &pre_mints, &keyset)
        .expect_err("matcher must fail closed when any change sig lacks DLEQ");

    match err {
        DleqVerificationError::ChangeSigMissingDleq { amount } => {
            assert_eq!(amount, 2, "the stripped sig was the amount=2 one");
        }
        other => panic!("expected ChangeSigMissingDleq, got {other:?}"),
    }
}

#[test]
fn matcher_handles_fewer_sigs_than_blanks() {
    // Mint returns M=2 sigs for N=4 blanks. Matcher must succeed and
    // return only the 2 matched proofs; the unmatched 2 blanks are
    // silently dropped (counter slots are burned, matches TS).
    let mint_secret =
        SecretKey::from_hex("0000000000000000000000000000000000000000000000000000000000000001")
            .unwrap();
    let keyset_id = KeysetId::from_str(KEYSET_ID_HEX).unwrap();
    let amounts = [
        Amount::from(1),
        Amount::from(2),
        Amount::from(4),
        Amount::from(8),
    ];
    let keyset = one_secret_keyset(&mint_secret, &amounts);

    let mut pre_mints = PreMintSecrets::new(keyset_id);
    for seed in 20..24u8 {
        pre_mints.secrets.push(build_blank(keyset_id, seed));
    }

    // Mint signs only blanks 0 and 2 (and returns them in reverse order
    // for good measure).
    let sig_blank_0 = mint_sign_change(
        &mint_secret,
        keyset_id,
        &pre_mints.secrets[0],
        Amount::from(1),
    );
    let sig_blank_2 = mint_sign_change(
        &mint_secret,
        keyset_id,
        &pre_mints.secrets[2],
        Amount::from(4),
    );
    let returned = vec![sig_blank_2.clone(), sig_blank_0.clone()];

    let matched = match_blind_signatures_to_pre_mints(&returned, &pre_mints, &keyset)
        .expect("matcher must succeed with partial returns");

    assert_eq!(matched.signatures.len(), 2);
    assert_eq!(matched.pre_mints.len(), 2);

    // Blank 2 came back first (amount=4); blank 0 second (amount=1).
    assert_eq!(matched.signatures[0].amount, Amount::from(4));
    assert_eq!(matched.signatures[1].amount, Amount::from(1));
    assert_eq!(matched.pre_mints[0].secret, pre_mints.secrets[2].secret);
    assert_eq!(matched.pre_mints[1].secret, pre_mints.secrets[0].secret);
}

#[test]
fn matcher_rejects_sig_with_no_matching_blank() {
    // Mint returns a signature whose blinded message corresponds to a
    // blank we never sent. Matcher must fail with NoMatchingBlank rather
    // than silently accepting an unrelated proof.
    let mint_secret =
        SecretKey::from_hex("0000000000000000000000000000000000000000000000000000000000000001")
            .unwrap();
    let keyset_id = KeysetId::from_str(KEYSET_ID_HEX).unwrap();
    let amounts = [Amount::from(1), Amount::from(2)];
    let keyset = one_secret_keyset(&mint_secret, &amounts);

    let mut pre_mints = PreMintSecrets::new(keyset_id);
    pre_mints.secrets.push(build_blank(keyset_id, 30));
    pre_mints.secrets.push(build_blank(keyset_id, 31));

    // A foreign blank we never registered.
    let foreign = build_blank(keyset_id, 99);
    let foreign_sig = mint_sign_change(&mint_secret, keyset_id, &foreign, Amount::from(2));

    let err = match_blind_signatures_to_pre_mints(&[foreign_sig], &pre_mints, &keyset)
        .expect_err("matcher must reject sigs that pair with no known blank");

    match err {
        DleqVerificationError::NoMatchingBlank { amount } => {
            assert_eq!(amount, 2);
        }
        other => panic!("expected NoMatchingBlank, got {other:?}"),
    }
}
