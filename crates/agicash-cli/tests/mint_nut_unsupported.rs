//! E2E: `mint add` against a Cashu mint whose `/v1/info` advertises
//! NO supported NUTs (specifically: empty NUT-04 mint settings, empty
//! NUT-05 melt settings). Roadmap entry **B2** in
//! `docs/superpowers/specs/2026-05-15-e2e-test-strategy.md`.
//!
//! Closes the matrix cell **"Mint: add NUT-unsupported mint → MISSING
//! (needs partial mint)"**.
//!
//! ## What this test PINS — and what it surfaces
//!
//! The strategy doc and the worker brief BOTH leave the contract
//! unpinned ("either rejects with a typed error OR adds the account
//! but flags unsupported flows on subsequent receive/send"). A read
//! of the production code in `agicash-cli/src/mint.rs::cmd_mint_add`
//! confirms there is **no NUT-capability check**: the function does
//! `cashu.provider.mint_info(&mint_url).await?`, then on success
//! drops the parsed `MintInfo` on the floor and `upsert`s the
//! account. Adding a partial-NUT mint silently succeeds today.
//!
//! This test PINS the actual (silent-success) contract and surfaces
//! the gap as a finding. When a worker decides which contract to
//! commit to, flip this test's assertion (see "Future contract
//! commitment" below).
//!
//! ## Mock mint approach
//!
//! No real mint with limited NUTs is available, so this test spins
//! up a tiny `tokio` TCP listener on a random localhost port that
//! responds to `GET /v1/info` with the minimal valid NUT-06
//! envelope: `{"name":"agicash-test-empty","nuts":{}}`. All other
//! NUT settings serde-default to empty/disabled (per `cashu-0.15`'s
//! `Nuts` struct in `cashu/src/nuts/nut06.rs:276`). The mock does
//! NOT serve `/v1/keysets`, `/v1/mint/quote/bolt11`, or any of the
//! actual mint endpoints — `mint add` only calls `/v1/info` today,
//! so that's all we need.
//!
//! Listener is bound on a `127.0.0.1:0` socket and the assigned
//! port is read out before `mint add` is invoked, so this test
//! cannot collide with any other process or with itself in
//! parallel runs. The listener task is spawned on a tokio runtime
//! the test owns and is cancelled when the test exits (the runtime
//! drops at the end of the test).
//!
//! ## Future contract commitment
//!
//! Two paths the team can take. PICK ONE in the next batch:
//!
//! 1. **Reject up front.** Add a NUT-04 + NUT-05 capability check
//!    to `cmd_mint_add`. Add an `unsupported-nut` (or `mint-error`
//!    with a sub-detail) entry to the catalog in `contracts.rs`.
//!    Flip `assert!(out.status.success())` below to
//!    `assert!(!out.status.success())` and assert on
//!    `extract_error_code`.
//!
//! 2. **Defer to flow time.** Document that `mint add` is "is the
//!    URL alive?" only and that capability checks happen at receive
//!    /send. Add a separate test that asserts `agicash receive token
//!    cashuB…` against a partial-NUT account produces a typed
//!    `mint-error` with a recognizable sub-message.
//!
//! Either is defensible; what's NOT defensible is the current
//! "succeed at add, succeed at later flows up until the moment a
//! real swap call panics on a missing endpoint" silent-failure mode.
//!
//! ## Run
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test mint_nut_unsupported -- --nocapture

#![allow(clippy::doc_markdown)]

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
mod common;

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
mod gated {
    use super::common::*;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    /// JSON body for the mock mint's `/v1/info` response. All NUT
    /// fields serde-default to empty / `supported: false`. NUT-04
    /// (mint) and NUT-05 (melt) `methods` arrays are empty → the
    /// mint advertises NO Lightning mint or melt support, which
    /// would make any subsequent receive/send impossible.
    const EMPTY_NUTS_INFO_BODY: &str = r#"{
        "name": "agicash-test-empty-nuts",
        "version": "0.0.0/0.0.0",
        "description": "test mint that advertises no NUTs",
        "nuts": {}
    }"#;

    /// RAII guard around the mock-mint listener thread. Sets a
    /// shared `stop` flag on drop so the accept-loop thread exits
    /// promptly (after at most one more accept timeout).
    struct MockMint {
        url: String,
        hits: Arc<AtomicUsize>,
        stop: Arc<AtomicBool>,
    }

    impl Drop for MockMint {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            // Tickle the listener so a blocked accept() returns.
            // Best-effort — if it fails, the thread will still
            // exit on the next accept timeout.
            let _ = std::net::TcpStream::connect_timeout(
                &self
                    .url
                    .strip_prefix("http://")
                    .unwrap_or(&self.url)
                    .parse::<SocketAddr>()
                    .expect("mock mint url has socket addr form"),
                Duration::from_millis(200),
            );
        }
    }

    /// Spawn a synchronous HTTP/1.1 mock mint on its own OS thread.
    /// Responds to any GET request with the empty-NUTs body. Returns
    /// the bound URL string (e.g. `http://127.0.0.1:54321`) plus a
    /// hit counter the caller can read after the test, plus a
    /// drop-stop flag.
    ///
    /// Implementation note: uses blocking `std::net` rather than
    /// tokio's `net` because the workspace tokio feature set doesn't
    /// include `net` or `io-util` by default and the brief forbids
    /// touching production sources (Cargo.toml is borderline; the
    /// blocking-thread approach sidesteps that question entirely).
    fn spawn_mock_mint() -> MockMint {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port for mock mint");
        listener
            .set_nonblocking(false)
            .expect("set blocking listener");
        let addr: SocketAddr = listener.local_addr().expect("get local addr");
        let url = format!("http://{addr}");
        let hits = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));

        let hits_thread = hits.clone();
        let stop_thread = stop.clone();
        thread::spawn(move || {
            for incoming in listener.incoming() {
                if stop_thread.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(mut socket) = incoming else {
                    continue;
                };
                let hits = hits_thread.clone();
                thread::spawn(move || {
                    let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));
                    let _ = socket.set_write_timeout(Some(Duration::from_secs(2)));
                    let mut buf = [0u8; 4096];
                    // Best-effort read: HTTP/1.1 GET headers fit
                    // comfortably in one buffer; we don't care
                    // about the path or method, the response is
                    // the same.
                    let _ = socket.read(&mut buf);
                    hits.fetch_add(1, Ordering::SeqCst);
                    let body = EMPTY_NUTS_INFO_BODY;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\n\
                         Content-Type: application/json\r\n\
                         Content-Length: {}\r\n\
                         Connection: close\r\n\
                         \r\n\
                         {}",
                        body.len(),
                        body,
                    );
                    let _ = socket.write_all(response.as_bytes());
                    let _ = socket.shutdown(std::net::Shutdown::Both);
                });
            }
        });

        MockMint { url, hits, stop }
    }

    /// PINS THE GAP: today `mint add http://<mock>` against a mint
    /// that advertises empty NUTs **succeeds** with `status="added"`
    /// and a fresh `account_id`. The strategy doc names the contract
    /// as undecided; this test pins the actual silent-success
    /// behaviour and the doc-comment above lays out the two
    /// candidate fixes.
    ///
    /// Asserts:
    ///   1. The mock `/v1/info` endpoint was hit ≥ 1 time (proves
    ///      the test is exercising the network path, not a cache).
    ///   2. `mint add` exits 0 with `status="added"`. (FUTURE: when
    ///      a NUT-capability check lands, flip to assert non-zero
    ///      exit and `code="unsupported-nut"` or whatever the
    ///      catalog gains.)
    ///   3. `account list` then surfaces a Cashu account for the
    ///      mock URL — the user is left holding a non-functional
    ///      account. (This is the "silent gap" the test exposes.)
    #[test]
    #[allow(clippy::too_many_lines)]
    fn mint_add_with_empty_nuts_currently_silently_succeeds() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let mock = spawn_mock_mint();

        let session = TestSession::new("mint-nut-unsupported");
        session.spawn_guest();

        let out = session
            .cmd()
            .args(["mint", "add", &mock.url])
            .output()
            .expect("spawn agicash mint add (mock mint)");

        // ---- Phase 1: PIN actual behaviour. ----
        assert!(
            out.status.success(),
            "PIN-GAP: today `mint add` against an empty-NUTs mint \
             succeeds. If this assertion flipped, a NUT-capability \
             check has landed — flip the assertions in this test \
             and add the new error code to ALLOWED_ERROR_CODES in \
             contracts.rs. stdout={}, stderr={}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr),
        );
        let body = parse_json("mint add (mock empty-nuts)", &out);
        assert_eq!(
            body.get("status").and_then(|v| v.as_str()),
            Some("added"),
            "PIN-GAP: today `mint add` reports status=added even with \
             zero NUTs supported. body={body}",
        );
        let account_id = body
            .get("account_id")
            .and_then(|v| v.as_str())
            .expect("account_id field");
        assert!(
            uuid::Uuid::parse_str(account_id).is_ok(),
            "expected UUID account_id, got `{account_id}`",
        );

        // ---- Phase 2: prove the mock was actually reached (we
        // didn't hit a cache, didn't accidentally talk to testnut). ----
        let hit_count = mock.hits.load(Ordering::SeqCst);
        assert!(
            hit_count >= 1,
            "mock `/v1/info` was never hit (hits={hit_count}) — the \
             CLI may have skipped the network call entirely, in \
             which case this test is not actually exercising the \
             empty-NUTs path",
        );

        // ---- Phase 3: surface the gap visibly. The user now has
        // a Cashu account attached to a mint that supports nothing.
        // List accounts and confirm it shows up. ----
        let list = session
            .cmd()
            .args(["account", "list"])
            .output()
            .expect("spawn agicash account list");
        assert!(
            list.status.success(),
            "account list failed: stderr={}",
            String::from_utf8_lossy(&list.stderr),
        );
        let list_json = parse_json("account list", &list);
        let accounts = list_json
            .as_array()
            .expect("account list must be a JSON array");
        let matching: Vec<&serde_json::Value> = accounts
            .iter()
            .filter(|a| {
                let purpose = a.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if purpose != "cashu" {
                    return false;
                }
                a.get("details")
                    .and_then(|d| d.get("mint_url"))
                    .and_then(|u| u.as_str())
                    .is_some_and(|s| s.trim_end_matches('/') == mock.url.trim_end_matches('/'))
            })
            .collect();
        assert_eq!(
            matching.len(),
            1,
            "PIN-GAP: empty-NUTs mock mint produced exactly one Cashu \
             account in account list (the user can't tell from this \
             alone that the mint won't actually mint or melt). \
             account_list={list_json}",
        );

        // mock dropped at end of scope → listener stops.
        drop(mock);
    }

    /// Companion: when the contract commitment lands (per the
    /// doc-comment above, path 1), this is the test we want.
    /// **Ignored** until then so the suite stays green; once a
    /// NUT-04/NUT-05 capability check is added to `cmd_mint_add`,
    /// drop the `#[ignore]` and update the silent-success test
    /// above to flip its assertions.
    #[test]
    #[ignore = "TODO: requires NUT-04/NUT-05 capability check in cmd_mint_add"]
    fn mint_add_with_empty_nuts_should_reject_with_typed_error() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let mock = spawn_mock_mint();

        let session = TestSession::new("mint-nut-unsupported-spec");
        session.spawn_guest();

        let out = session
            .cmd()
            .args(["mint", "add", &mock.url])
            .output()
            .expect("spawn agicash mint add (mock mint)");

        assert!(
            !out.status.success(),
            "mint add against empty-NUTs mint should fail with a \
             typed error per the future contract; got success: \
             stdout={}",
            String::from_utf8_lossy(&out.stdout),
        );
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        let code = extract_error_code("mint add (empty nuts, spec)", &stderr);
        // Exact code TBD by the team — likely a new `unsupported-nut`
        // or a sub-detail on `mint-error`. Update both this assert
        // and the contracts.rs allow-list when committed.
        assert!(
            code == "unsupported-nut" || code == "mint-error",
            "expected unsupported-nut or mint-error, got `{code}`. \
             stderr={stderr}",
        );
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn mint_nut_unsupported_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
         --test mint_nut_unsupported"
    );
}
