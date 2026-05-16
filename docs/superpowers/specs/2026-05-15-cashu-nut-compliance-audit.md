# Cashu NUT compliance audit — agicash-cashu (Rust)

Date: 2026-05-15
Scope: `crates/agicash-cashu/` (the Rust implementation that drives
real-money receive/send). Cross-check against the official Cashu NUT
specs at https://github.com/cashubtc/nuts and against CDK 0.15.1
(`/Users/claude/.cargo/registry/src/.../cdk-0.15.1`, `cashu-0.15.1`)
since the impl trusts CDK for everything below the
`MintConnector` trait.

This audit is read-only. No source modified.

## TL;DR (executive summary)

The biggest hole is **NUT-12 DLEQ verification: not performed
anywhere in the Rust hot paths** — neither on the blind signatures we
get back from the mint after `swap`/`mint`/`melt`, nor on inline
DLEQs that come in proofs from another wallet inside a `cashuB`
token. The agicash impl bypasses CDK's `Wallet` saga and talks to
the mint via raw `MintConnector` calls; the saga (which does
opportunistic `verify_dleq`) is therefore not engaged. CDK's
`construct_proofs` only *records* the DLEQ — it never verifies it.
This is the highest-risk deviation and is rated **HIGH**.

Other notable findings:

- **NUT-07 check-state on receive: not implemented in Rust.** The TS
  app calls `wallet.checkProofsStates` to filter unspent proofs
  before swap; the Rust receive path swaps directly and only learns
  about already-spent proofs via the error path. This is a UX +
  correctness issue, rated **MED**.
- **NUT-06 mint-info: re-fetched on every call.** `provider.rs`
  caches the HTTP client but not the response. Validators that walk
  NUT support flags will re-hit the mint each time. **LOW**.
- **NUT-04/05 error classification: substring-matching on
  `Debug`/`Display` of `cdk::error::Error`.** Brittle. CDK error
  message wording is not stable across versions; a wording change
  could cause `BlindedMessageAlreadySigned` to be miscategorised
  and the mint round-trip to incorrectly retry instead of restore.
  **MED**.
- **NUT-11 P2PK: deferred and intentionally gated.** Mints get
  feature-gated via `mint-validation.ts` so the wallet only attaches
  to mints advertising P2PK support, but the Rust impl has no path
  to construct P2PK-locked secrets or verify witnesses. **NOT-
  IMPLEMENTED, intentional**.
- **NUT-20 quote signature locking: deferred.** `mint_quote/service.rs`
  passes `pubkey: None` and writes `locking_derivation_path: ""`.
  **NOT-IMPLEMENTED, intentional but exposes a window** —
  see DEVIATIONS below.

## Per-NUT scorecard

| NUT | Topic | Score | Severity |
|-----|-------|-------|----------|
| 00 | Cryptography, Token V3/V4 | COMPLIANT (V4 only on emit) | — |
| 01 | `GET /v1/keys` keyset fetch | COMPLIANT | — |
| 02 | Keysets, fee_ppk, active flag | COMPLIANT (with caveat: no inactive-keyset rotation preference) | LOW |
| 03 | Swap (`POST /v1/swap`) | COMPLIANT (request shape), **DEVIATION** on DLEQ verification of returned sigs | HIGH (via NUT-12) |
| 04 | Mint quote (Lightning) | COMPLIANT | — |
| 05 | Melt quote (Lightning) | COMPLIANT (BOLT-11 only; no amountless) | — |
| 06 | Mint info | DEVIATION — uncached, refetched per call | LOW |
| 07 | Proof state check | NOT-IMPLEMENTED in Rust (TS app uses it) | MED |
| 08 | Lightning fee return + change blanks | COMPLIANT | — |
| 11 | P2PK locked tokens | NOT-IMPLEMENTED, intentional | — |
| 12 | DLEQ proofs | **DEVIATION — never verified** | HIGH |
| 13 | Deterministic secrets (seed-derived) | COMPLIANT (CDK `PreMintSecrets::from_seed`, `from_seed_blank` mirror) | — |
| 17 | WebSocket subscriptions | NOT-IMPLEMENTED in Rust (TS app polls; gate via mint-info) | LOW |
| 20 | Quote signature locking | NOT-IMPLEMENTED, **windowed risk** | MED |

## Detailed deviations

### NUT-12: DLEQ proofs — DEVIATION (HIGH)

**Spec (NUT-12):** "Wallets MUST verify the DLEQ proof" in two
contexts: blind signatures returned by the mint (so a malicious mint
cannot pretend to have signed with a key it did not commit to), and
inline DLEQs accompanying proofs sent peer-to-peer (so a recipient
can verify offline that proofs were legitimately signed by the
mint).

**Our behavior:** Neither check happens in the Rust impl.

1. After `swap`/`mint`, agicash calls `cdk::dhke::construct_proofs`
   (see `receive_swap/service.rs:343-353`,
   `send_swap/service.rs:513-534`,
   `mint_quote/service.rs:448-458`,
   `melt_quote/service.rs:751-771`). `construct_proofs`
   (`cashu-0.15.1/src/dhke.rs:117-158`) records the DLEQ on the
   resulting `Proof` if present, but never calls `verify_dleq`. The
   only place CDK calls `verify_dleq` is inside its higher-level
   `Wallet` saga (`cdk-0.15.1/src/wallet/issue/saga/mod.rs:369`,
   `wallet/receive/saga/mod.rs:138`, `wallet/mod.rs:821`). agicash
   does not use the saga — it talks to the mint via the lower-level
   `MintConnector::post_swap`/`post_mint`/`post_melt`. The DLEQ
   verification path is therefore **bypassed**.
2. When parsing incoming peer-to-peer tokens
   (`receive_swap/service.rs::ParsedToken::parse`,
   line 450-507), agicash converts CDK proofs to `TokenProof` via
   `cdk_proof_to_token_proof` (line 632-641), which **explicitly
   drops the DLEQ** (`dleq: None`). Even if a sender attached a
   valid DLEQ, we discard it before swap.

**Why this matters for real-money send/receive:**

- Without (1), a malicious mint could return signatures from a key
  it does not advertise; the wallet would store proofs that the mint
  could later refuse to redeem (denial of service / lost funds).
  This is a real attack surface on every interaction with a new
  mint and every key rotation.
- Without (2), a sender giving us a token could ship valid-looking
  proofs that the mint refuses; we'd discover only on swap. Less
  severe in agicash because we *do* swap on receive, but it
  forfeits the trustless-receive guarantee NUT-12 is built to
  provide.

**Confirmed via CDK source.** `cashu-0.15.1/src/dhke.rs:143`
(`let dleq = blinded_signature.dleq.map(|d| ProofDleq::new(d.e, d.s, r));`)
records it; only the wallet saga calls `verify_dleq`. The slice 8
worker's note ("no DLEQ matching, trusts CDK's positional
construct_proofs") was **correct**: CDK does NOT verify DLEQ via
`construct_proofs`.

**Recommendation (highest priority):**

1. After every `post_swap` / `post_mint` response, loop the returned
   `BlindSignature`s and call
   `BlindSignature::verify_dleq(mint_pubkey, blinded_message)` for
   each one whose `dleq` field is `Some`. On `Err(_)`, reject the
   entire response and surface a `MintSignatureUnverifiable` error.
   Match CDK's saga semantics: tolerate `Err(MissingDleqProof)` only
   if the mint doesn't advertise NUT-12. Locations to patch:
   - `receive_swap/service.rs::perform_mint_swap` (line 343)
   - `send_swap/service.rs::perform_mint_swap` (line 513, 524 — two
     batches: send + change)
   - `mint_quote/service.rs::perform_mint` (line 448)
   - `melt_quote/service.rs::construct_change_proofs` (line 759)
2. On the inline-proof receive path
   (`receive_swap/service.rs::ParsedToken::parse`), preserve the
   incoming `dleq` field instead of dropping to `None` in
   `cdk_proof_to_token_proof` (line 632). Then in `create()`, before
   calling `storage.create`, run `Proof::verify_dleq` on every
   incoming proof that has a DLEQ; reject any token where the DLEQ
   is present but invalid. (Tokens without DLEQs continue to work —
   that's the spec's "no inline DLEQ" path.)

Both fixes are local to agicash-cashu and don't require CDK
changes. The mint pubkey is already available via
`fetch_keyset_keys`; the per-amount key is on `KeySet::keys`.

### NUT-07: Proof state check — NOT-IMPLEMENTED (Rust); MED severity

**Spec (NUT-07):** Wallets *may* call `POST /v1/checkstate` to
classify proofs as `UNSPENT`/`PENDING`/`SPENT`. NUT-07 itself is
optional, but its operational use ("filter unspent proofs before
attempting a swap") is a common pattern.

**Our behavior:**

- TS app (`app/lib/cashu/token.ts::getUnspentProofsFromToken`,
  invoked from `app/features/receive/receive-cashu-token-hooks.ts:106`)
  calls `wallet.checkProofsStates` before attempting receive so it
  can surface a useful error before the mint swap.
- Rust receive-swap and send-swap services do **not** call any
  equivalent. Instead they swap directly and parse the mint's error
  via `is_already_claimed_error` / `is_already_executed_error`
  substring matching.

**Why it matters:** The status quo is functional but degrades the
error message ("post_swap: ..." instead of "already spent before we
tried") and creates a race window where two devices restoring from
the same seed could both attempt to swap. The mint will reject the
second one — agicash relies on the restore fallback to recover —
but the restore path returns empty for some mints and is the
single point of failure for "the proofs we thought were ours
disappeared". Pre-flighting with NUT-07 catches this earlier.

**Recommendation (MED):** Add a `proof_state_check` method on
`CashuProvider` (delegates to `MintConnector::post_check_state`) and
call it from `receive_swap/service.rs::create` before persisting the
PENDING swap row — reject the receive (with a clear error) if any
proof returns `SPENT`. Optional follow-up: also call it in send-swap
before reserving proofs that the local DB thinks are unspent but
might be in-flight from another device.

### NUT-06: Mint info caching — DEVIATION (LOW)

**Spec (NUT-06):** No caching requirement. `GET /v1/info` is
informational; wallets are free to fetch on demand. Mint info
contains the NUT capability flags that gate features like NUT-11
P2PK, NUT-12 DLEQ, NUT-17 websockets, NUT-20 locking.

**Our behavior:** `provider.rs::mint_info` (line 79) fetches every
call. `provider.rs::get_or_create` caches the `HttpClient` but not
the `MintInfo`. Validators in TS (`mint-validation.ts`) effectively
hit the mint twice per operation (once for keys, once for info).

**Why it matters:** Minor latency + bandwidth, but more importantly
this makes NUT-capability gating expensive — every NUT-12 verify
attempt would re-fetch mint info to learn whether NUT-12 is
advertised. Caching once per session (with manual refresh on
`account.add`) is sufficient.

**Recommendation (LOW):** Add an `Arc<RwLock<HashMap<MintUrl,
(MintInfo, Instant)>>>` next to `clients` in `CdkCashuProvider` and
return cached info under a TTL (10 minutes is the cashu-ts
default). Add an explicit `invalidate(mint_url)` for use after
mint-rotation events.

### NUT-04 / NUT-05: Error classification — DEVIATION (MED)

**Spec:** Numeric error codes (`10002` = `BlindedMessageAlreadySigned`,
`11001` = `TokenAlreadySpent`) are the wire-stable contract. CDK's
`cdk::error::Error` enum maps them onto typed variants.

**Our behavior:** `is_already_claimed_error`
(`receive_swap/service.rs:643-677`), `is_already_executed_error`
(`send_swap/service.rs:827-846`), `is_already_issued_error`
(`mint_quote/service.rs:620-640`) all combine three heuristics:

1. Direct variant match on `cdk::error::Error::TokenAlreadySpent` /
   `BlindedMessageAlreadySigned`.
2. Lowercased substring search on the `Display` impl
   ("already spent", "already signed", ...).
3. Substring search on the `Debug` impl ("TokenAlreadySpent",
   "11001", ...).

Heuristic (1) is correct. (2) and (3) are brittle — CDK can change
wording in a point release and the wallet would silently start
treating "already spent" as "unknown error", which collapses the
restore-on-already-claimed fallback. The result: a legitimate
double-claim attempt would surface as a transient error and could
leave a swap stuck in PENDING.

**Recommendation (MED):** Drop (2) and (3). If CDK 0.15's typed
variants don't cover every wire code we care about, file an
upstream issue or wrap the underlying `ErrorResponse` directly
(it has a numeric `code` field that's wire-stable). The current
fallback hides a latent regression.

### NUT-20: Quote signature locking — NOT-IMPLEMENTED, windowed risk (MED)

**Spec (NUT-20):** A mint quote can be locked to a pubkey so only
the holder of the corresponding private key can issue proofs against
the quote. Without this, anyone who learns the `quote` ID before the
legitimate wallet calls `/v1/mint` can race-issue the proofs.

**Our behavior:** `mint_quote/service.rs:98-103` passes
`pubkey: None`. `locking_derivation_path` is hard-coded to `""`
throughout. Mints supporting NUT-20 will accept the quote unlocked.

**Why it matters:** NUT-04 explicitly warns: "The `quote` ID MUST
remain a secret between user and mint and MUST NOT be derivable from
the payment request." If the quote ID leaks (logs, error traces,
analytics), the funds the user paid into the invoice can be claimed
by anyone who can reach the mint. With NUT-20 enabled, leakage is
recoverable; without it, leakage = loss.

**Recommendation (MED):** Either enforce that mints requiring
NUT-20 are not used until we implement it (gate via
`mint-validation.ts` — currently NUT-20 is in the `requiredNuts`
list but the Rust path doesn't honor the lock), or wire derivation
through `cashu_locking_xpub` (already provisioned on the user row)
and pass the pubkey + signature to the mint. Until either lands,
audit log paths for any place we render `quote_id` (CLI output, FFI
logs, error messages) and scrub them.

### NUT-02: Keyset rotation preference — DEVIATION (LOW)

**Spec (NUT-02):** "Wallets should prioritize swaps with proofs from
inactive keysets" to help mints rotate away from compromised keys.

**Our behavior:** `select_send_proofs` in
`send_swap/service.rs:753-787` sorts proofs descending by amount,
not by keyset age. We never preferentially burn inactive-keyset
proofs.

**Why it matters:** Minor. The mint can still accept inactive-keyset
inputs forever; this is a soft rotation hint.

**Recommendation (LOW):** When two proofs have equal amount, prefer
the one whose keyset is inactive (or whose `final_expiry` is
nearest). Track via `KeySetInfo::active`.

## Compliant areas (worth keeping)

- **NUT-08 change blanks**: `melt_quote/service.rs::build_change_pre_mint`
  (line 711-749) builds N blanks deterministically from
  `(seed, keyset_id, keyset_counter)` with `Amount::ZERO`, exactly
  matching `cashu-0.15.1/src/nuts/nut13.rs::from_seed_blank`. The
  blank count uses `number_of_change_blanks` (integer
  `ceil(log2(max_change))` via `64 - leading_zeros(n - 1)`),
  matching the spec's `max(ceil(log2(fee_reserve)), 1)`.
- **NUT-13 deterministic secrets**: All four services derive via
  `PreMintSecrets::from_seed(keyset_id, counter, seed, ...)`. Counter
  bumping is tracked per-keyset on `account.details.keyset_counters`
  and persisted before the mint round-trip — even on restore the
  counter advances, so we don't replay secrets. Correct.
- **NUT-02 fee math**: `compute_fee_for_proofs` uses
  `div_ceil(1000)` with summed `input_fee_ppk`. Matches the spec
  formula `(sum_fees + 999) // 1000`. Unit-tested
  (`send_swap/service.rs:1057-1083`).
- **NUT-04/05 quote state polling**: Both quote services use the
  documented `GET /v1/{mint,melt}/quote/...` polling loop with
  configurable interval + timeout. State transitions handled.
- **Restore-on-already-signed**: All four services try
  `post_restore` when the mint reports already-signed. This is the
  correct recovery posture per CDK's saga pattern.

## Top-5 recommended fixes (priority order)

1. **NUT-12 DLEQ verification** on every blind signature returned by
   the mint, in all four services (receive_swap, send_swap,
   mint_quote, melt_quote). Plus preserve + verify inline DLEQs on
   incoming peer tokens. [HIGH]
2. **NUT-07 pre-flight `check_state`** on receive (and optionally on
   send-swap proof selection). [MED]
3. **Drop substring error classification.** Switch to typed variants
   only; if coverage is incomplete, wrap CDK's `ErrorResponse.code`
   directly. [MED]
4. **NUT-20 mint-quote pubkey locking** (or hard-disable mints that
   require it until it lands). Until then, scrub `quote_id` from
   user-visible surfaces. [MED]
5. **Cache `MintInfo` per session** with a TTL + explicit
   `invalidate(mint_url)`. Cheap to add, removes a per-call mint
   round-trip. [LOW]

## Methodology

- Read the four service files in `crates/agicash-cashu/src/` end to
  end (receive_swap, send_swap, mint_quote, melt_quote, provider).
- Confirmed CDK behavior by reading the published source at
  `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`:
  - `cashu-0.15.1/src/dhke.rs::construct_proofs` (DLEQ not
    verified)
  - `cashu-0.15.1/src/nuts/nut12.rs` (`verify_dleq` API)
  - `cashu-0.15.1/src/nuts/nut13.rs::from_seed_blank` (NUT-08 change
    blank derivation)
  - `cdk-0.15.1/src/wallet/{issue,receive,swap}/saga/mod.rs`
    (DLEQ verification only in the saga, not the connector)
- Cross-checked TS app paths (`app/lib/cashu/`,
  `app/features/{receive,send,settings}/`) for behaviors the Rust
  port omits.
- Pulled NUT specs via `https://raw.githubusercontent.com/cashubtc/nuts/main/{00,01,02,03,04,05,06,07,08,11,12}.md`.

## Out of scope

- WebSocket subscriptions (NUT-17) — Rust port uses polling. Gating
  is enforced via mint-info in TS, so this is a feature gap, not a
  correctness issue.
- NUT-15 (multi-path payments) — not used.
- NUT-19 / NUT-21 — not used.
- Storage-layer compliance (Supabase row shapes, RPC contracts) —
  separately audited.
