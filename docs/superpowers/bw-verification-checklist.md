# Variant B (store-based) — browser/live verification checklist (OWED)

> Built headless + gate-green + per-task/whole-branch reviewed clean on `sdkx/store` (B-engine tip `8f06fab7`, B-web tip `f0de923a`). This checklist is the **owed browser/live verification** — it cannot run in-loop (needs a live stack: Docker + `bun supabase start` + dev server + `VITE_BREEZ_API_KEY` + Breez regtest). Run via Chrome DevTools MCP + the `verify`/`run` skills, exactly as Variant A's `aw-verification-checklist.md` was run. Do NOT mark B "done" or push until these pass.

## Setup gotchas (carried from A's live run)
- `.env` needed at BOTH worktree-root AND `apps/web-wallet/.env` (Vite loads from the app dir).
- `server.ts` hardcodes `certs/localhost-*.pem` (copy `ci-localhost-*` → `localhost-*`).
- Chrome rejects the dev-server self-signed cert for the `localhost:3000` PAGE → run the app over `http://localhost:3000` (bun SSR trusts the self-signed Supabase via `NODE_TLS_REJECT_UNAUTHORIZED=0`; the browser accepts the `127.0.0.1:54321` Supabase cert so data+realtime work from the http page).
- Vite 504-optimize-dep / transient "multiple copies of React" cleared by a hard reload.

## B-SPECIFIC priority checks (the store-model risks)
1. **LOAD-BEFORE-SERVE / no empty-store flash (the #1 B risk — the analogue of A's `ensureLoaded` bug).** Fresh guest sign-in AND returning-session reload: the first wallet render must NOT flash empty accounts / null user. `useStoreSuspense` must SUSPEND on cold stores (root `<Suspense>` → LoadingScreen) and render real data — never `[]`/`null` placeholder. Verify accounts list + balances + default account are populated on first paint. (Engine fix: `createStoreSdk` defers `getUser` to `sdkReady`, so stores are `undefined`-until-real, never placeholder-seeded.)
2. **`_protected` sync route-guards** (accept-terms, verify-email, token claim) read `getUserFromCacheOrThrow()` → `sdk.user.current.get()` synchronously in middleware. Verify they do NOT throw `'User not found'` on a fresh load (the middleware `sdk.user.current.set(() => user)` seed must land before the guards read).
3. **Live balance via the accounts store**: pay an invoice → balance updates (cashu via `account:updated` fanout → store; spark via the `live-spark-balances.ts` overlay fed by Breez events). Verify BOTH cashu + spark balances go live.
4. **Active trackers via lifecycle events (coarser-than-A intermediate liveness — confirm acceptable)**: Lightning receive (cashu + spark) UNPAID→paid → `useTrackCashuReceiveQuote`/`useTrackSparkReceiveQuote` fire `onPaid` via `receive:completed`; receive expiry → `onExpired` via `receive:expired`; token-send share route → `useTrackCashuSendSwap` reflects COMPLETED/FAILED via `send:completed`/`send:failed`. Confirm the terminal transition is observed (intermediate PENDING ticks may only refresh on focus/lifecycle — this is the intended A-vs-B contrast; assess whether the UX is acceptable).
5. **tx-detail / list / unack liveness via `useTransactionLifecycleSync`**: while viewing `/transactions/:id`, a terminal transition invalidates + refetches the detail; the list + unack-count update on lifecycle events.
6. **No double realtime**: only the SDK's `ChangeFeed` subscribes `wallet:${userId}` now (app realtime deleted) — confirm one subscription, no leaked listeners across sign-in/out.

## Shared money-path + lifecycle checks (same as A)
7. Boot + hydrate (public `/home`, `/login`, `/signup`); guest sign-in end-to-end (OpenSecret attestation + enclave key-exchange + Supabase session + `auth.ensureUser` → user + 3 default accounts); wallet home loads with zero console errors.
8. 2-tab leader election + ≤10s failover; kill-leader-mid-flow → other instance completes it (single SDK leader; app leader deleted).
9. reconnect → `connection:state` + `fanout.onCatchUp` refetches all 9 stores (airplane-mode → resume).
10. online/offline + visibilitychange → `setOnlineStatus`/`setActiveStatus`; focus/online → `sdk.resync()`.
11. session-expiry (full-user toast+redirect; guest silent re-auth); Google OAuth round-trip; password-reset.
12. Lightning send (cashu + spark) UNPAID→PENDING→PAID on the leader; token-send renders QR immediately (createTokenSend PENDING sync).
13. Receive + token claim: deep-link `?claimTo` (gift-card + normal) success-redirect + DomainError toast; interactive claim same-account AND cross-account (add-unknown account, NO default set) — `createTokenClaim`. **Re-check the BW-T6 cross-feature claim repoint (claim-to-new-mint).**
14. accounts/contacts live; transactions list/detail/unack live; live Spark balance overlay.
15. feature-flags anon RPC (via the kept `agicashDbClient`); LAN dev (`getSupabaseUrl` rewrite, no double-rewrite; `location.host` = canonical origin on Vercel previews); `/lnurl-test`.
16. Residual paths still work over `agicashDbClient`: `transaction-additional-details` (4× `getByTransactionId`), `useReverseTransaction`, `useAccountOrNull` expired-account lazy fetch.

## Pre-PR (shared with A, gated on the user's nod)
- A SHARED-BASE biome normalization (do once on `sdkx/base`; both variants inherit — NOT a per-variant pass, to keep A/B diffs comparable). Clears the accumulated import-ordering Minors (BE-T7, BW-T9, BW-T13) on both.
- The standing push gate: Breez connect smoke + live realtime + `/lnurl-test` + user nod.
