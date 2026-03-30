---
title: Universal QR Scanner with Dynamic Routing
type: feat
status: proposed
date: 2026-03-30
depends_on:
  - "agicash #959 (offer accounts)"
  - "cdk #14 (purpose enum in mint info — merged)"
  - "agicash-mints #49 (infrastructure wiring — open)"
  - "agicash #960 (account lifecycle/expiry — open)"
---

> A single scanner on the home screen that reads any QR code — cashu token, lightning address, BOLT11 invoice — and routes you to the right flow automatically. No more choosing "send" or "receive" before scanning.

## Context

The wallet currently has three scanner wrappers — send, receive, and transfer — each behind its own route. Users must decide what they're scanning before they scan. This creates friction: you shouldn't need to know what a QR code contains to use it.

**Current state:**
- `QRScanner` component (`app/components/qr-scanner/qr-scanner.tsx`) is already reusable. It accepts `onDecode(decoded: string)` and handles camera, animated QR (BC-UR), and a 3000ms throttle.
- Send scanner routes through `sendStore.selectDestination(input)` which chains: contact → LN address → BOLT11 → cashu payment request.
- Receive scanner uses `extractCashuToken()` from SDK.
- Home page header (`app/routes/_protected._index.tsx`) has left/center/right slots via `PageHeader` + `PageHeaderItem`.

**What we're adding:** One scanner icon in the home header (top-left, before gift cards). Scan anything, go to the right place.

## Open Questions

1. **Should the scanner live at its own route or render as a modal/overlay?**
   Recommendation: Own route (`/_protected/scan`). Consistent with existing scanner pages, uses the same `PageHeader + PageContent + QRScanner` pattern, and view transitions work naturally.

2. **What happens when PR #959 (offer accounts) hasn't landed yet?**
   Recommendation: Ship without offer tier. The account priority falls back to gift-card > transactional. When #959 lands, add `offer` to the priority list — it's a one-line change in the matcher.

3. **Should the paste button support all input types or just tokens?**
   Recommendation: All types. The routing logic is the same regardless of input source (camera vs clipboard). No reason to restrict.

4. **How to handle expired BOLT11 invoices?**
   Recommendation: Let the existing send flow handle it. The universal scanner's job is routing, not validation. The send confirmation screen already checks expiry.

## Principles

1. **Route, don't validate.** The scanner determines _type_ and hands off. Each flow owns its own validation and error handling.
2. **Input-agnostic routing.** Camera scan and paste button feed the same `routeInput()` function. One code path, two input sources.
3. **Graceful degradation on account matching.** If smart selection can't find a match, fall through to normal send flow. Never block the user.
4. **No new stores.** Routing is stateless — parse, classify, navigate. State lives in the existing send/receive stores.
5. **Reuse existing scanner component.** Zero changes to `QRScanner` itself. The universal scanner is just another thin wrapper with smarter `onDecode`.
6. **Feature-flag the icon.** Same pattern as the gift cards icon in the header. Ship behind a flag, enable when ready.
7. **Account priority is data-driven.** The priority order (offer > gift-card > transactional) comes from a ranked list, not if/else chains. Easy to reorder or extend.

## Phase 0: Input Classifier

**Goal:** Pure function that takes a string and returns what it is.

**What to build:**
- `classifyInput(input: string)` in `app/features/scan/classify-input.ts`
- Returns: `{ type: 'cashu-token', data: TokenMetadata } | { type: 'bolt11', data: DecodedInvoice } | { type: 'ln-address', data: string } | { type: 'unknown' }`
- Reuses existing parsers: `extractCashuToken()` from SDK, `decodeBolt11()` from `packages/sdk/src/lib/bolt11`, LN address regex (already in send store's destination chain)
- Order: cashu token → BOLT11 → LN address → unknown

**Verification:** Unit tests covering each type + edge cases (prefixed strings like `lightning:`, `cashu:`, mixed case, invalid inputs).

**Risk:** Low. Pure function, no side effects, existing parsers do the heavy lifting.

**Depends on:** Nothing.

## Phase 1: Smart Account Selector

**Goal:** Given a BOLT11 invoice, pick the best account to pay from.

**What to build:**
- `selectAccountForInvoice(invoice: DecodedInvoice, accounts: Account[], mintInfoMap: Map<string, MintInfo>)` in `app/features/scan/select-account.ts`
- Logic:
  1. Extract `description` from decoded BOLT11
  2. For each account's mint, check `MintInfo.name` for exact match against description
  3. Among matched accounts, rank by purpose: `offer` > `gift-card` > `transactional`
  4. At each tier, check `account.balance >= invoice.amount` and `canSendToLightning(account)`
  5. Return first account that passes, or `null` (caller falls through to normal flow)
- Use `mintInfoQueryOptions(mintUrl)` to get cached mint info (already 1hr stale time via TanStack Query)

**Verification:** Unit tests with mock accounts and mint info. Cases: exact match single account, multi-account priority ordering, insufficient balance fallback, no match returns null, gift-card accounts filtered by `canSendToLightning`.

**Risk:** Medium. Description matching is fragile — mint names may not match invoice descriptions exactly. Acceptable for v1 since fallback is always available.

**Depends on:** Phase 0 (for `DecodedInvoice` type). PR #959 for offer account purpose (ship without, add later).

## Phase 2: Universal Scanner Route + Routing

**Goal:** Scannable page at `/_protected/scan` that classifies input and navigates to the right flow.

**What to build:**
- Route file: `app/routes/_protected.scan.tsx`
- Thin wrapper: `PageHeader` + `PageContent` + `QRScanner` + paste button (same pattern as existing scanners)
- `onDecode` handler:
  1. Call `classifyInput(decoded)`
  2. Route by type:
     - `cashu-token` → navigate to `/receive/cashu/token#<encoded-token>` (existing receive flow)
     - `ln-address` → navigate to `/send` with destination pre-set via `sendStore.selectDestination(input)`
     - `bolt11` → call `selectAccountForInvoice()`, then navigate to `/send` with `?accountId=xxx` if match found, or plain `/send` + `selectDestination` if not
     - `unknown` → show toast/error: "Please scan a valid QR code"
  3. Use `useNavigateWithViewTransition` for navigation
- Paste button: reads clipboard, feeds same `onDecode` handler

**Verification:** Manual testing for each input type. Confirm correct routing for cashu token, LN address, BOLT11 with/without account match, and unknown input.

**Risk:** Medium. Navigation timing — need to ensure `sendStore.selectDestination()` completes before the send page renders. Existing scanners solve this the same way, so follow their pattern.

**Depends on:** Phase 0, Phase 1.

## Phase 3: Home Header Icon + Feature Flag

**Goal:** QR scanner icon in the home page header, behind a feature flag.

**What to build:**
- Add `PageHeaderItem` to the `left` slot of `PageHeader` in `app/routes/_protected._index.tsx`
- Icon: `ScanLine` from lucide-react (QR viewfinder style), or `QrCode` — match Strike's aesthetic
- Links to `/_protected/scan`
- Feature flag: same mechanism as the gift cards icon (check existing pattern in the header file)
- Position: leftmost icon, before gift cards

**Verification:** Toggle feature flag on/off. Icon appears/disappears. Tap navigates to scanner. View transition works.

**Risk:** Low. Additive UI change, feature-flagged.

**Depends on:** Phase 2.

## Phase 4: Retire Standalone Scanners

**Goal:** Remove redundant scanner entry points once universal scanner is stable.

**What to build:**
- Remove or redirect `/send/scan` route → universal scanner
- Remove or redirect `/receive/scan` route → universal scanner
- Keep transfer scanner if transfer flow has distinct UX needs; otherwise redirect too
- Update any in-app links pointing to old scanner routes

**Verification:** Verify no dead routes. Confirm deep links and back navigation still work. Run full E2E suite.

**Risk:** Medium. Other features may deep-link to `/send/scan` or `/receive/scan`. Search the codebase for all references before removing.

**Depends on:** Phase 3 (universal scanner proven stable in production behind flag).

## Files Changed

| File | Change | Phase |
|------|--------|-------|
| `app/features/scan/classify-input.ts` | New — input classifier | 0 |
| `app/features/scan/classify-input.test.ts` | New — classifier tests | 0 |
| `app/features/scan/select-account.ts` | New — smart account selector | 1 |
| `app/features/scan/select-account.test.ts` | New — selector tests | 1 |
| `app/routes/_protected.scan.tsx` | New — universal scanner route | 2 |
| `app/routes/_protected._index.tsx` | Modify — add scanner icon to header | 3 |
| `app/features/send/send-scanner.tsx` | Remove or redirect | 4 |
| `app/features/receive/receive-scanner.tsx` | Remove or redirect | 4 |
| `app/routes/_protected.send.scan.tsx` | Remove or redirect | 4 |
| `app/routes/_protected.receive.scan.tsx` | Remove or redirect | 4 |

## Who Executes

Autonomous. Phases 0-1 are pure functions with tests — any worker can ship them independently. Phases 2-3 follow established scanner/header patterns exactly. Phase 4 requires a codebase-wide reference search but is mechanical. No design decisions remain open.
