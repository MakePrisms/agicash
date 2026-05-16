# NUT-08 Melt Change Handling — TypeScript ⇄ Rust Parity Audit

Date: 2026-05-16
Worktree: `~/agicash/.claude/worktrees/nut-12-dleq-verify` (branch
`feat/nut-12-dleq-verify`)
Scope: NUT-08 (Lightning fee return / change blanks) — send-side only.
Focus: how the wallet generates change blanks, calls the mint, and turns
returned BlindSignatures into Proofs. Receive-side melts
(`cashu-token-melt-data.ts`) are out of scope.

## TL;DR

**Verdict: DELTAS (3 functional, 1 latent bug, 1 cosmetic).**

The Rust port and the TS reference agree on the macro-shape — same blank
count formula, same deterministic derivation from `(seed, keyset_id,
counter)`, same DLEQ-verify-before-unblind discipline — but they diverge
on **three** points that change observable behavior:

1. **Latent bug (P1):** Rust's `construct_change_proofs` truncates the
   blinded-message slice for the DLEQ check but passes the **full** `rs`
   / `secrets` vectors into `cdk::dhke::construct_proofs`. When the mint
   returns `sigs.len() < N`, `construct_proofs` errors out with `Lengths
   of promises, rs, and secrets must be equal` and the whole melt fails
   post-payment. **The fewer-sigs case the operator wanted to support
   does not actually work.**
2. **Pairing strategy (P1):** TS pairs sigs ↔ blanks by **DLEQ-reblind
   trial matching** (`matchBlindSignaturesToOutputData`), explicitly
   refusing to trust positional ordering and citing
   https://github.com/cashubtc/cashu-ts/issues/287 (CDK + Nutshell return
   change from a SQL query without `ORDER BY`). Rust pairs **positionally**.
   This violates the operator's assumption #2: the assumption is
   contradicted by the TS reference's load-bearing comment.
3. **DLEQ persistence (P2):** TS persists the DLEQ on every change proof
   (`dleq: x.dleq ?? null`). Rust drops it on the wire to storage
   (`proof_to_token_proof` hard-codes `dleq: None`). Inconsistent with
   the same lane's `receive_swap::cdk_proof_to_token_proof` fix.

Cosmetic-only:

4. **Blank amount placeholder.** Rust uses `Amount::ZERO`; TS uses `1`.
   Mint overwrites either way. No-op for the wire, document and move on.

The Rust DLEQ verification step itself (the new
`crate::dleq::verify_blind_signatures` call) is **safer than TS** — TS
only verifies DLEQ as a *side effect* of trial-matching; Rust verifies
unconditionally on the positional pairing, including the no-change-needed
case where TS would also short-circuit. Keep this; flag for upstream TS
follow-up.

---

## TS flow (with file:line)

### High-level orchestration

`CashuSendQuoteService` drives three phases:

1. **`getLightningQuote`** — quote + proof selection + change-output count
   estimation. `app/features/send/cashu-send-quote-service.ts:98-199`.
2. **`createSendQuote`** — persists the row with the locked-in
   `numberOfChangeOutputs` and the pre-bump `keysetCounter`.
   `cashu-send-quote-service.ts:204-323`.
3. **`initiateSend` → `completeSendQuote`** — calls the mint and
   reconstructs change proofs. `cashu-send-quote-service.ts:330-457`.

### Pre-mint blank count

Identical formula on both sides:

```ts
// cashu-send-quote-service.ts:286-291
const maxPotentialChangeAmount =
  proofsToSendSum - meltQuote.amount - proofsFee;
const numberOfChangeOutputs =
  maxPotentialChangeAmount === 0
    ? 0
    : Math.ceil(Math.log2(maxPotentialChangeAmount)) || 1;
```

`|| 1` is a quirk: `log2(1) === 0`, so `ceil(log2(1)) === 0`, and the
`|| 1` clause bumps it to 1. Rust mirrors this exactly via integer math
(`number_of_change_blanks`, `melt_quote/service.rs:691-702`). Parity. ✅

### Calling the mint (`initiateSend`)

```ts
// cashu-send-quote-service.ts:349-359
return wallet.meltProofsIdempotent(
  meltQuote,
  sendQuote.proofs.map((p) => toProof(p)),
  { keysetId: sendQuote.keysetId },
  { type: 'deterministic', counter: sendQuote.keysetCounter },
);
```

`meltProofsIdempotent` is a thin wrapper around cashu-ts
`meltProofsBolt11` (`app/lib/cashu/utils.ts:239-265`). Note: this call's
return value is **discarded** — the change proofs cashu-ts constructs
internally are not used by agicash. (cashu-ts does build them with
positional pairing — `node_modules/@cashu/cashu-ts/lib/cashu-ts.es.js:7185`
— but that result never reaches the agicash DB.)

cashu-ts internally asserts `change.length <= outputData.length`
(`cashu-ts.es.js:7181-7184`), so the "mint returns more sigs than blanks"
case throws inside cashu-ts before agicash can observe it. This is the
contract that justifies the operator's assumption #1.

### Reconstructing change proofs (`completeSendQuote`)

```ts
// cashu-send-quote-service.ts:425-443
// The change BlindSignatures from the mint may be in non-deterministic order
// (both CDK and Nutshell return them from a SQL query without ORDER BY),
// so we match them to OutputData via DLEQ verification rather than positional pairing.
// See https://github.com/cashubtc/cashu-ts/issues/287 for why we re-derive OutputData here.
await wallet.keyChain.ensureKeysetKeys(sendQuote.keysetId);
const keyset = wallet.getKeyset(sendQuote.keysetId);
const amounts = sendQuote.numberOfChangeOutputs
  ? Array(sendQuote.numberOfChangeOutputs).fill(1)
  : [];
const outputData = OutputData.createDeterministicData(
  amounts.length,
  wallet.seed,
  sendQuote.keysetCounter,
  keyset,
  amounts,
);
const changeProofs = meltQuote.change?.length
  ? matchBlindSignaturesToOutputData(meltQuote.change, outputData, keyset)
  : [];
```

The input `meltQuote.change: SerializedBlindedSignature[]` comes from the
subscription/poll path (`spark-send-quote-hooks.ts:491-499` →
`completeSendQuote` mutation, `cashu-send-quote-hooks.ts:404-431`). It is
the raw mint response, not cashu-ts's already-unblinded proofs.

Inside `matchBlindSignaturesToOutputData`
(`app/lib/cashu/blind-signature-matching.ts:23-89`):

- Builds an `unmatched` set of all outputData indices.
- For each incoming signature, iterates the unmatched indices, trial-
  unblinds via `od.toProof(sig, keyset)`, then runs
  `verifyDLEQProof_reblind(secret, {s, e, r=blindingFactor}, C, K)`.
- First match wins; that outputData index leaves the unmatched set.
- Throws `'Cannot match blind signatures without DLEQ proofs (NUT-12)'`
  if any signature lacks a DLEQ (i.e. mint doesn't advertise NUT-12).
  **TS therefore fails closed against non-NUT-12 mints on the change
  path.**
- Throws `'No matching OutputData found for blind signature'` if a sig
  can't be matched to any blank.
- Logs a `console.warn` when reordering was needed.

Then persists with the DLEQ preserved:

```ts
// cashu-send-quote-repository.ts:251-262
const encryptedProofs = changeProofs.map((x, index) => {
  ...
  return {
    keysetId: x.id,
    amount: encryptedProofData[encryptedDataIndex],
    secret: encryptedProofData[encryptedDataIndex + 1],
    unblindedSignature: x.C,
    publicKeyY: proofToY(x),
    dleq: x.dleq ?? null,
    witness: x.witness ?? null,
  };
});
```

`toProof` itself
(`node_modules/@cashu/cashu-ts/lib/cashu-ts.es.js:4323-4345`) attaches
`{s, e, r: blindingFactor}` to `proof.dleq`. So a change proof carries
the full inline DLEQ tuple downstream.

### TS amount-spent computation

```ts
// cashu-send-quote-service.ts:445-449
const amountSpent = new Money({
  amount: sumProofs(sendQuote.proofs) - sumProofs(changeProofs),
  ...
});
```

Same arithmetic Rust does (`service.rs:509-516`). Parity. ✅

---

## Rust flow (with file:line)

### Pre-mint blank count

`melt_quote/service.rs:146-147` (in `get_quote`):

```rust
let max_change = proofs_total.saturating_sub(quoted_amount + cashu_fee_value);
let number_of_change_outputs = number_of_change_blanks(max_change);
```

`number_of_change_blanks` is the integer-math equivalent of TS's `||1`
clause (`service.rs:691-702`). Tested in
`service.rs:1015-1030`. Parity. ✅

### Pre-mint blank construction

`service.rs:711-749` `build_change_pre_mint`. Builds N `PreMint` entries
with secrets/blinding-factors derived from `(seed, keyset_id, counter+i)`
and `BlindedMessage::new(Amount::ZERO, keyset_id, blinded)`. The
counter-bump-then-write pattern is handled at the DB layer via
`number_of_change_outputs` on the row.

The placeholder `Amount::ZERO` is **the same convention CDK uses**
(`cashu-0.16.0/src/nuts/nut13.rs:176`), so this is the more "Rust-native"
shape. TS uses `Array(N).fill(1)` instead — both are valid because the
mint replaces the amount.

### Calling the mint

`service.rs:281-322` (`initiate_melt`) and `service.rs:380-420`
(`poll_until_complete`). Both build a `MeltRequest` with the full input
proofs + blinded blank messages, post via `wallet.connector().post_melt`
/ `get_melt_quote_status`, then call `construct_change_proofs` on the
`response.change` field.

### Reconstructing change proofs

`service.rs:751-782`:

```rust
fn construct_change_proofs(
    sigs: &[BlindSignature],
    pre_mint: &PreMintSecrets,
    mint_keys: &KeySet,
) -> Result<Vec<Proof>, MeltQuoteError> {
    if sigs.is_empty() {
        return Ok(Vec::new());
    }
    let blinded = pre_mint.blinded_messages();
    let truncated = &blinded[..sigs.len().min(blinded.len())];
    crate::dleq::verify_blind_signatures(sigs, truncated, mint_keys)
        .map_err(MeltQuoteError::DleqVerificationFailed)?;

    let proofs = construct_proofs(
        sigs.to_vec(),
        pre_mint.rs(),       // ← full N
        pre_mint.secrets(),  // ← full N
        &mint_keys.keys,
    )
    .map_err(|e| { ... })?;
    Ok(proofs)
}
```

Pairing is **positional** (zip), based on the order the mint returns
sigs. Truncation only affects the DLEQ slice; the unblinding receives
the full `rs`/`secrets`.

### Persistence

`service.rs:517-518` calls `proof_to_token_proof` (`service.rs:784-793`),
which hard-codes `dleq: None`. The DLEQ that `construct_proofs` attached
(see `cashu-0.16.0/src/dhke.rs:143`) is **dropped before storage**.

---

## Side-by-side

| Step | TS (cashu-ts + agicash wrapper) | Rust port |
|---|---|---|
| Blank count formula | `ceil(log2(max_change)) \|\| 1`, `0` if `max_change == 0` (`cashu-send-quote-service.ts:286-291`) | Integer-math equivalent (`service.rs:691-702`) |
| Blank placeholder amount | `1` for each (`Array(N).fill(1)`, `cashu-send-quote-service.ts:431-433`) | `Amount::ZERO` (`service.rs:738`) |
| Blank derivation | `OutputData.createDeterministicData(seed, counter, keyset, [1×N])` (`cashu-send-quote-service.ts:434-440`) | `Secret::from_seed` + `SecretKey::from_seed` + `blind_message` for `counter..counter+N` (`service.rs:723-746`) |
| Mint call | `wallet.meltProofsBolt11(...)` via `meltProofsIdempotent` (`cashu-send-quote-service.ts:349`) — result discarded | `wallet.connector().post_melt(...)` (`service.rs:300-303`) or `get_melt_quote_status` on poll path (`service.rs:390-398`) |
| Mint returns MORE sigs than blanks | cashu-ts internal: throws (`cashu-ts.es.js:7181-7184`); agicash never sees it | Not defended against — `[..sigs.len().min(blinded.len())]` silently truncates; `construct_proofs` then fails with length-mismatch error. (Same outcome — failure — but later and noisier.) |
| Mint returns FEWER sigs than blanks | Trial-matches present sigs only; unmatched blanks silently dropped. Counter has already been bumped to `counter+N` (`createSendQuote` reserved them). Net effect: lose the un-claimed blanks but melt succeeds. | **Broken.** DLEQ slice truncates correctly, but `construct_proofs(sigs.to_vec(), pre_mint.rs() /* full N */, pre_mint.secrets() /* full N */, ...)` errors with `"Lengths of promises, rs, and secrets must be equal"` (`cashu-0.16.0/src/dhke.rs:123-132`). Melt fails after the mint has paid. |
| Mint returns sigs OUT OF ORDER | Trial-match via DLEQ-reblind handles it; logs `console.warn` (`blind-signature-matching.ts:80-86`) | Positional pairing — `construct_proofs`'s zip pairs `sigs[i]` with `rs[i], secrets[i]`. If mint returns out of order, every unblinding fails the DLEQ check because the wrong blinding factor is used. Melt fails after the mint has paid. |
| DLEQ verification | Implicit — part of trial-matching (`blind-signature-matching.ts:53-62`). No verification if `numberOfChangeOutputs === 0`. | Explicit — `crate::dleq::verify_blind_signatures` over the truncated prefix (`service.rs:767`). Tolerates `dleq: None` for non-NUT-12 mints (`dleq.rs:99-103`). |
| Behavior when mint doesn't advertise NUT-12 | `matchBlindSignaturesToOutputData` throws `'Cannot match blind signatures without DLEQ proofs (NUT-12)'` (`blind-signature-matching.ts:34-38`). **Fails closed.** | `verify_blind_signatures` `continue`s on `sig.dleq.is_none()`. **Falls back to positional unblinding without verification.** Matches CDK saga semantics; arguably less safe than TS. |
| Change-proof DLEQ persisted | Yes — `dleq: x.dleq ?? null` (`cashu-send-quote-repository.ts:259`) | No — `dleq: None` hard-coded (`service.rs:790`) |
| Amount-spent | `sum(sendProofs) - sum(changeProofs)` (`cashu-send-quote-service.ts:445-449`) | `proofs_sum.saturating_sub(change_sum)` (`service.rs:509-516`) |

---

## Verdict: DELTAS

The truncation safety claim ("we truncate the blinded-message slice to
the returned signature count") is **half-implemented**: the DLEQ check
truncates, but the unblinding step does not. Listed below in priority
order.

### DELTA 1 (P1, latent bug): `construct_proofs` receives un-truncated rs/secrets

**Symptom.** Mint paid, returned `K < N` change sigs, melt errors with
`MeltQuoteError::Mint(Protocol("construct_proofs (change): Lengths of
promises, rs, and secrets must be equal"))`. The user's funds are spent
on the Lightning side but the change proofs are lost.

**Site.** `crates/agicash-cashu/src/melt_quote/service.rs:770-781`

**Minimal fix (do not apply — operator reviews):**

```diff
-    let proofs = construct_proofs(
-        sigs.to_vec(),
-        pre_mint.rs(),
-        pre_mint.secrets(),
-        &mint_keys.keys,
-    )
+    let n = sigs.len().min(pre_mint.len());
+    let proofs = construct_proofs(
+        sigs.to_vec(),
+        pre_mint.rs()[..n].to_vec(),
+        pre_mint.secrets()[..n].to_vec(),
+        &mint_keys.keys,
+    )
```

This is the exact pattern CDK's own saga uses
(`cdk-0.16.0/src/wallet/melt/saga/mod.rs:103-121`). Adopt their tracing
warning too:

```rust
if sigs.len() != pre_mint.len() {
    tracing::warn!(
        "mint returned {} change sigs for {} blanks; truncating",
        sigs.len(),
        pre_mint.len(),
    );
}
```

**Counter accounting.** The DB row has already reserved
`counter..counter+N` (via `create_quote`). If the mint returns only K
sigs, the wallet will derive K proofs but the on-row counter is bumped
to `counter+N`. Unclaimed blanks `(K..N)` are effectively burned —
nobody can ever ask the mint to fulfill them later. This is fine (matches
TS) but worth documenting in `complete_with_change`.

### DELTA 2 (P1, pairing strategy): assumption #2 contradicted by reference

**Symptom.** If the mint (Nutshell or CDK ≤ a future fix) returns change
sigs in non-deterministic SQL order, the Rust port fails every DLEQ
verification (wrong blinding factor for every sig) and the melt errors
out after payment. TS works because it trial-matches.

**Site.** `crates/agicash-cashu/src/melt_quote/service.rs:751-782` and
`crates/agicash-cashu/src/dleq.rs:87-119` (the latter rejects on
`CountMismatch` and assumes positional pairing).

**The operator's assumption.** "Sigs are always returned in positional
order (assume + document, don't defend against)." This assumption is
**not safe**: the TS reference deliberately encodes the opposite
assumption with a load-bearing comment citing
https://github.com/cashubtc/cashu-ts/issues/287, and the GitHub issue
calls out that both CDK and Nutshell read change from SQL without
`ORDER BY`. The mints in the wild that this lane targets — Nutshell
mainnet/signet, CDK-based mints — are exactly the ones the TS comment
flags as misbehaving.

**Two options for the operator:**

**Option A (match TS).** Port `matchBlindSignaturesToOutputData` to Rust:

- Strip `verify_blind_signatures` from `construct_change_proofs`.
- Trial-unblind each returned sig against every still-unmatched blank,
  verify the DLEQ on the candidate proof, accept first match.
- Reject if any sig has `dleq: None` (TS behavior — fail closed).
- Keep the truncation: returned-sig count drives the loop, unmatched
  blanks are dropped.

Rough sketch (~30 LOC):

```rust
fn construct_change_proofs(
    sigs: &[BlindSignature],
    pre_mint: &PreMintSecrets,
    mint_keys: &KeySet,
) -> Result<Vec<Proof>, MeltQuoteError> {
    use std::collections::HashSet;
    let mut unmatched: HashSet<usize> = (0..pre_mint.len()).collect();
    let mut proofs = Vec::with_capacity(sigs.len());
    for sig in sigs {
        let dleq = sig.dleq.as_ref().ok_or_else(|| {
            MeltQuoteError::Mint(CashuProviderError::Protocol(
                "change sig missing DLEQ — mint does not advertise NUT-12".into(),
            ))
        })?;
        let mint_pubkey = mint_keys.keys.amount_key(sig.amount).ok_or_else(|| {
            MeltQuoteError::DleqVerificationFailed(
                crate::dleq::DleqVerificationError::NoKeyForAmount {
                    amount: u64::from(sig.amount),
                    keyset_id: mint_keys.id.to_string(),
                },
            )
        })?;
        let matched = unmatched.iter().copied().find(|&i| {
            let pm = &pre_mint.secrets[i];
            // verify_dleq is on BlindSignature; signature itself
            // carries `e` and `s`, blinded message gives B'.
            sig.verify_dleq(mint_pubkey, pm.blinded_message.blinded_secret).is_ok()
        });
        let Some(i) = matched else {
            return Err(MeltQuoteError::Mint(CashuProviderError::Protocol(format!(
                "no matching blank for change sig amount={}",
                u64::from(sig.amount)
            ))));
        };
        unmatched.remove(&i);
        let pm = &pre_mint.secrets[i];
        let unblinded = cdk::dhke::unblind_message(&sig.c, &pm.r, mint_pubkey)
            .map_err(|e| MeltQuoteError::Mint(CashuProviderError::Protocol(format!("unblind: {e}"))))?;
        proofs.push(Proof {
            amount: sig.amount,
            keyset_id: sig.keyset_id,
            secret: pm.secret.clone(),
            c: unblinded,
            witness: None,
            dleq: Some(cdk::nuts::nut12::ProofDleq::new(dleq.e, dleq.s, pm.r.clone())),
            p2pk_e: None,
        });
    }
    Ok(proofs)
}
```

This makes assumption #2 unnecessary — we no longer assume positional
order. It also moves the failure mode from "mint paid, melt fails after"
to "mint paid, all change reconstructed correctly", which is the safer
direction.

**Option B (keep positional but apply DELTA 1 fix, document assumption
loud).** If the operator confirms the deployed mint set does return
sigs positionally (e.g. by checking the Nutshell and CDK code paths
this lane targets), then DELTA 1 alone is enough. The audit recommends
Option A because the TS reference explicitly considers this assumption
unsafe.

### DELTA 3 (P2, DLEQ persistence): change proofs lose their DLEQ on the way to storage

**Symptom.** Receivers of a token whose proofs originate as our melt
change cannot do inline NUT-12 verification — their DLEQ is `None` on
the wire because we stripped it before writing to the DB.

**Site.** `crates/agicash-cashu/src/melt_quote/service.rs:784-793`

**Minimal fix:**

```diff
 fn proof_to_token_proof(proof: &Proof) -> TokenProof {
     TokenProof {
         id: proof.keyset_id.to_string(),
         amount: u64::from(proof.amount),
         secret: proof.secret.to_string(),
         c: proof.c.to_hex(),
-        dleq: None,
+        dleq: dleq_to_json(proof.dleq.as_ref()),
         witness: None,
     }
 }
```

Reuse the `dleq_to_json` helper from
`crates/agicash-cashu/src/receive_swap/service.rs:692-694` (this is the
sibling fix already shipped in this lane for the receive path; the melt
path was missed). Same parity argument the lane is built on.

If `token_proof_to_cdk_proof` (`service.rs:795-817`) needs to round-trip
DLEQs as well — currently it sets `dleq: None` going *into* CDK — that's
a separate fix; the melt-quote service only round-trips proofs for
inputs, where missing DLEQs are NUT-12-irrelevant. Out of scope for this
audit but worth a sweep.

### DELTA 4 (cosmetic): blank amount placeholder

TS uses `1`, Rust uses `Amount::ZERO`. Both are placeholders the mint
replaces. CDK's own `from_seed_blank` uses `0`. No fix needed; document
in `build_change_pre_mint` rustdoc that the value is irrelevant — the
mint NUT-08 spec says the wallet picks the amount distribution but the
mint can override.

---

## Surprises worth flagging

1. **TS fails closed on non-NUT-12 mints for change.** Even if the rest
   of the mint advertises NUT-12, `matchBlindSignaturesToOutputData`
   throws if even one returned change sig lacks a DLEQ
   (`blind-signature-matching.ts:34-38`). This is stricter than the
   "tolerate missing DLEQ" rule the new Rust `verify_blind_signatures`
   adopts from CDK's saga. If you take Option A above you inherit this
   stricter behavior, which is arguably the safer default for change
   proofs (since they're the ones with the trust-minimization story).

2. **TS discards cashu-ts's positionally-paired change.** `initiateSend`
   throws away the `change` field that `meltProofsBolt11` returns and
   instead re-derives OutputData from seed in `completeSendQuote`. The
   `meltProofsBolt11` return value is essentially used as a side-effect
   trigger. The Rust port has no analogue of this two-phase split
   because it talks to the mint directly via `post_melt` — but the
   subscription/poll flow (`poll_until_complete`) does mirror the TS
   shape of "re-derive blanks from quote-row state, run them against
   the polled mint status." Good parity.

3. **Counter advance on no-change-needed.** When
   `numberOfChangeOutputs === 0`, neither side advances the keyset
   counter. Symmetric. Rust avoids a `for 0..0` loop via the early
   `Ok(PreMintSecrets::new(keyset_id))` at `service.rs:718-720`. Fine.

4. **The Rust DLEQ verification is *better* than TS in one respect.**
   When change is non-empty, the Rust path always runs
   `verify_blind_signatures` on the truncated prefix. TS only verifies
   as part of the trial-matching loop, so if the mint returned `0`
   sigs (NUT-08 says it's allowed to skip change entirely), neither
   side verifies anything — but Rust's explicit step makes the
   no-DLEQ-vs-bad-DLEQ distinction surfaceable to logs. Document this
   as a TS-side follow-up: TS could add a pre-loop verification pass
   for clearer error attribution.

5. **`construct_proofs` length-mismatch error message.** Currently
   surfaces as `MeltQuoteError::Mint(Protocol("construct_proofs
   (change): Lengths of promises, rs, and secrets must be equal"))`.
   When DELTA 1 is fixed and the truncation works, this error path
   becomes unreachable for the legitimate fewer-sigs case. Worth
   keeping it as a defensive `unreachable!()` debug-assert after the
   fix, or upgrading to a typed error.

---

## What stays the same (parity confirmed)

- Blank count formula and `|| 1` clause.
- Deterministic derivation: `(seed, keyset_id, counter+i)` → secret +
  blinding factor.
- Counter is bumped at quote creation, persisted on the row, re-used at
  completion time (no on-the-fly increment).
- Amount-spent computation: `sum(inputs) - sum(change)`.
- Idempotency: TS via try/catch on `meltProofsBolt11`
  (`utils.ts:253-264`); Rust via DB state machine
  (`MeltQuoteMachine` + `mark_as_pending` → `complete`/`fail`).
- Failure surface: both refuse to fail a quote the mint already paid
  (TS `failSendQuote` line 487-493; Rust `fail` line 480-495).

---

## Recommended action sequence

1. **Acknowledge** Option A vs Option B trade-off (DELTA 2). This is the
   real architectural question — everything else follows from it.
2. If Option A: implement the trial-match port. DELTA 1 becomes moot
   (the new flow doesn't call `construct_proofs` with truncated args).
3. If Option B: apply DELTA 1's truncation fix. Audit Nutshell + CDK
   melt-change-return code paths to confirm assumption #2. Add a
   regression test that constructs a fake `BlindSignature[]` in mint
   order and ensures unblinding succeeds; add a second test where order
   is reversed and document the expected failure mode.
4. **Apply DELTA 3** (DLEQ persistence) regardless — it's a one-line
   parity fix with the lane's stated invariant.
5. Optional follow-up: file a TS issue (or PR) suggesting a pre-loop
   `verify_blind_signatures`-style sweep before trial-matching, for
   error attribution. Reference this audit.

No code changed in this audit. Operator decides.
