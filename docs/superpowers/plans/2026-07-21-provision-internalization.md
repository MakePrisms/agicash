# Provision internalization — design decisions

Direction agreed by both maintainers (Discord thread, 7/21). No code here —
this settles the open decisions so the build round can start. Each decision
lists the options and our recommendation; rule on them like the B-rounds.

Grounding: head `da633cab` plus the session-lifecycle hardening PR (this doc
**assumes that PR lands first** — the transition-suspension in D5 builds
directly on the session signal/dispose machinery it adds). File:line refs are
on that tree.

## Settled (constraints — not re-opened here)

- Provision moves fully **SDK-internal**, fired on the SDK auth lifecycle:
  `signUp`, `signInGuest`, `signIn`, `restore`, and mid-session identity change.
- Guarded by an **identity fingerprint** (`userId` + `email` + `emailVerified`)
  vs the last-provisioned state — re-provisions only when it changes.
- Seed data reaches the host via a **`session.established` event** carrying
  `{ user, accounts }`; the host re-seeds its caches by plain reads.
- **Terms decouple from provision**: the pending-terms `sessionStorage` stays
  web-side and is replayed post-auth via `acceptTerms`.
- The web provision gate is deleted: `hasUserChanged`
  (`apps/web-wallet/app/routes/_protected.tsx:42`), the provisioning path in
  `ensureUserData` (`:64-82`), and its terms plumbing.

## Current shapes (what changes)

- Host-side gate today: `_protected.tsx:52-85` `ensureUserData` calls
  `sdk.user.provision(...)` (`:71`) whenever there's no cached user or
  `hasUserChanged` (`:64`), then seeds `UserCache`/`AccountsCache` (`:80-81`);
  pending terms read at `:128-134`.
- SDK provision today: `packages/wallet-sdk/domain/user/user-api.ts:104-180`
  (host-called; takes `termsAcceptedAt`/`giftCardMintTermsAcceptedAt`).
- Event carrier: `packages/wallet-sdk/domain/sdk/events.ts` — `WalletEventEmitter`
  dispatches to *current* handlers only (`:103-120`), **no replay**; `on()` is
  callable with no session and returns unsubscribe (`:74-82`); adding an event is
  non-breaking (`:16-21`).
- Auth lifecycle: `auth-service.ts:200-203` (`signIn` awaits `os.signIn` then
  `refreshSessionSnapshot`); `:295-315` (`applySessionFromServer`: `fetchUser` →
  different-user `onSessionEnded` `:308-311` → `startNewSessionScope` → set
  session); `init()` → `restoreSession` (`sdk.ts:161-163`).

---

## D1 — `session.established` event shape

**Decision:** payload, and how a host that subscribes *after* the initial
establish still gets it.

The emitter has no replay (`events.ts:103-120`): an event fired during `init()`
is lost to a host that subscribes after `init()` resolves (the common React
case — the tree mounts after boot).

- **(a) emit-only** — host must `on(...)` before `init()`. Cheap, but a fragile
  ordering contract; a late subscriber silently gets no seed.
- **(b) replay-latest (recommended)** — the emitter retains the last
  `session.established` payload and replays it to a late subscriber (only this
  event, not the whole bus). Robust regardless of subscribe/`init()` order.
- **(c) read-after-init** — no event for the initial seed; host reads
  `{user, accounts}` via plain getters once `init()` resolves, event only for
  mid-session change. Simple but splits initial vs mid-session into two host
  paths.

**Recommendation: (b).** Payload `{ user: User; accounts: Account[] }`. Fires on
every establish (initial + mid-session identity change), after the snapshot +
internal provision complete; `init()` resolves after the initial establish.
Replay-latest keeps one host path and removes the subscribe-before-`init()`
footgun; it's a small targeted retention on one event, not general buffering.

## D2 — terms replay (petar's ruling pending — both presented)

`provision` stops taking terms; the web replays pending acceptance via
`acceptTerms` after auth.

- **(a) `acceptTerms({ acceptedAt? })` (recommended)** — web passes the timestamp
  captured when the user actually accepted (pre-auth). Preserves the true ToS
  acceptance time.
- **(b) stamp-at-replay** — `acceptTerms` stamps `now()` at replay. Simpler, but
  records a time later than the real acceptance (drift across the auth round-trip
  and any retry), which matters for a ToS audit trail.

**Recommendation: (a)** — the acceptance time is a legal/audit fact; record when
the user clicked, not when the SDK got around to persisting it. (petar to rule.)

## D3 — provision-failure surface during `signIn`/`restore`

Provision now runs *inside* the auth verb. Auth can succeed while provision
fails (DB error, derivation) — the user is authenticated but unseeded.

- **(a) reject the auth verb** — `signIn`/`init` reject on provision failure.
  Conflates "login failed" with "seeding failed"; a genuinely logged-in user
  looks logged-out.
- **(b) `session.established` carries the outcome (recommended)** — discriminated
  payload `{ user, accounts } | { user, error }`; auth resolves successfully,
  the host learns provision failed from the event and can offer retry (re-fire
  provision) without re-authenticating.
- **(c) separate `provision.failed` event** — extra event; host must correlate it
  with the establish.

**Recommendation: (b)** — separates auth success from seed success, matching
reality. `init()` still resolves (restore succeeded); the event reports the seed
result. Provision already self-retries transient failures
(`user-api.ts:147-172`), so the error surfaced here is the terminal one.

## D4 — fingerprint persistence

- **(a) in-memory per instance (recommended)** — reset on cold boot; provision
  re-fires on the first auth after boot. That's exactly today's semantics
  (`ensureUserData:60-64` provisions whenever there's no cached user, i.e. every
  cold load) and provision is an idempotent upsert, so the re-fire is cheap and
  safe.
- **(b) durable (localStorage)** — survives boot, skips the boot-time upsert.
  Adds a persistence surface and a staleness/tampering risk for the gain of one
  idempotent upsert per cold boot.

**Recommendation: (a)** — matches cold-boot semantics, no new persisted state.

## D5 — ★ auth-transition ordering (the foundation)

Internal provision runs *during* sign-in, which turns a cross-user window our
session-lifecycle review found (details and reproduction in the accompanying
review notes) from an optional fix into a **required foundation** for this
round.

Today `signIn` awaits `os.signIn(B)` (`auth-service.ts:200-203`), and Open Secret
writes B's tokens before returning; the different-user cleanup
(`onSessionEnded` → `keys.reset()`) only runs after B's `fetchUser`
(`:308-311`). So in the window between the token write and the snapshot apply,
snapshot = A and the session signal is still A's, but a fresh derivation reads
B's identity. Our review reproduced provision upserting **user A with B's
keys**. Once provision is SDK-internal and fired on `signIn`, the SDK *itself*
drives an operation through that window — it is no longer only a racing host
call.

**Design — transition suspension.** Before the token-mutating call:

1. `beginTransition()` — abort the current session scope (in-flight
   key-dependent ops reject `SessionEndedError`, per the fence) and set a
   `transitioning` flag under which new key getters and internal provision
   reject/defer.
2. `os.signIn(B)` / `signInGuest` / `signUp` (token mutation) runs while
   suspended — nothing key-dependent can act on the mismatched snapshot.
3. `applySessionFromServer` (after `fetchUser`) installs the fresh scope, clears
   `transitioning`, sets the new snapshot, then fires `session.established` and
   runs internal provision — now unambiguously under B.
4. Rollback: if the auth call throws, clear `transitioning` and restore the prior
   state (or `endSession`), so a failed switch doesn't strand the instance
   suspended.

**Recommendation:** adopt the suspension as the foundation of this round. This is
the auth-mutation serialization petar declined in #1166 [37]; the new
justification is concrete — internalizing provision makes the window
self-exercised and cross-user, so it must close here. Gate it with a real Open
Secret integration test driving `signIn(B)` over a live A session (the unit
fakes can't exercise the token-write ordering).

## D6 — migration path

- **#1167 ships as-is:** host-called `sdk.user.provision` + the session fence +
  the web `ensureUserData` gate that calls it. Provision stays host-driven.
- **This round (lands after #1167 merges) deletes:** `hasUserChanged`
  (`_protected.tsx:42`), the provisioning path in `ensureUserData` (`:64-82`),
  and the web terms plumbing — replaced by SDK-internal provision on the auth
  lifecycle + `session.established` + the D5 suspension + web terms replay.
- **Out of scope (stays):** the `/temporary` key prefetches in `ensureUserData`
  (`:65-78`, encryption/seed/spark-mnemonic for unmigrated receive/send/claim) —
  those die with their features at step 18, not here. This round removes only the
  provision gate, not the key prefetches.

**Recommendation:** sequence strictly after #1167 and the session-lifecycle
hardening PR (the D5 substrate); keep the `/temporary` prefetch removal on the
step-18 track.
