# Public Cashu Token Receive

How unauthenticated users receive Cashu tokens. This doc covers the **routing and handoff** between public and protected pages. Once the user is authenticated and the claim executes, the normal flows apply — see `cashu-receive-swap.md` (same-account) and `cross-account-claim.md` (different account).

## Two Routes, One Token

Tokens arrive via URL hash (`#cashuB...`). Two routes handle them:

| Route | Layout | Renders |
|-------|--------|---------|
| `_public.receive-cashu-token` | `_public` | `PublicReceiveCashuToken` (no auth required) |
| `_protected.receive.cashu_.token` | `_protected` | `ReceiveCashuToken` (auth required) |

**Public route's `clientLoader`** checks `isLoggedIn` first — if already authenticated, redirects to the protected route immediately (preserving search params + hash).

## Public Page (Unauthenticated)

The public page lets the user preview the token and choose how to claim it **before** signing in.

### Placeholder Accounts

Since no real accounts exist yet, the page builds **in-memory placeholder accounts** (never persisted):

- **Spark placeholder** — static stub via `createSparkWalletStub()`, always available if the source and send to Lightning
- **Cashu placeholder** — built via `buildAccountForMint(mintUrl, currency)` which fetches mint info and runs validation

`useReceiveCashuTokenAccountPlaceholders()` returns both as selectable options. Default selection:
- Source can send to Lightning (normal mint) → Spark is default
- Source cannot send to Lightning (test mint / gift card) → Cashu source account is default and only option

### Token Validation

Same `useCashuTokenWithClaimableProofs()` hook as the protected page — queries the mint for proof state, filters to unspent proofs the user can claim. Runs without auth since it only talks to the Cashu mint, not Supabase.

### Two Claim Paths

The page shows up to two buttons:

**1. "Claim as Guest"** (behind `GUEST_SIGNUP` feature flag):
```
User clicks → AcceptTerms screen → handleClaimAsGuest():
  a) pendingTermsStorage.set(timestamp) — persists acceptance for user record creation
  b) addClaimToSearchParam(navigate, location, receiveAccount.type)
     → Modifies URL to add ?claimTo=spark|cashu (based on selected placeholder)
  c) signUpGuest() — creates Open Secret guest account + Supabase session
  d) Auth state changes → public clientLoader re-runs → isLoggedIn=true
     → Redirect to protected route with ?claimTo=... and #cashuB... intact
```

**2. "Log In and Claim"** (always shown):
```
Navigate to /login with:
  - search: redirectTo=/receive/cashu/token
  - hash: #cashuB... (the encoded token)
User logs in → redirected to protected route (no claimTo param)
```

## Protected Route Handoff

The protected route's `clientLoader` handles two scenarios:

### With `claimTo` param (guest signup / auto-claim)

```
clientLoader detects claimTo param
  → Constructs ClaimCashuTokenService with full dependency tree
  → Calls claimToken(user, token, claimTo) immediately in the loader
  → On success: redirect to /
  → On failure: toast error, redirect to /
```

This is an **immediate claim in the loader** — no UI is rendered. The `claimTo` value (`'cashu'` | `'spark'`) maps directly to the `claimTo` parameter of `ClaimCashuTokenService.claimToken()` (see `cashu-receive-swap.md` → Token Claim Dispatch).

### Without `claimTo` param (login redirect / direct navigation)

```
clientLoader returns { token, selectedAccountId }
  → Renders ReceiveCashuToken component
  → User sees accounts, selects one, clicks "Claim"
  → claimTokenMutation fires → same routing as Token Claim Dispatch
```

This uses the `useReceiveCashuTokenAccounts()` hook which fetches real accounts from the DB via `useAccounts()`. However, if the user does **not** have an existing account at the token's mint, `getSourceAndDestinationAccounts()` builds a **placeholder source account** via `buildAccountForMint()` (with `isUnknown: true`). This placeholder appears in the selectable destination accounts alongside real accounts. The UI reflects this: the button shows "Add Mint and Claim" when the selected account is unknown, and the account is persisted to the DB when the user confirms. The full `getDefaultReceiveAccount()` priority logic documented in `cross-account-claim.md` applies.

## Key Differences: Public vs Protected

| Aspect | Public | Protected |
|--------|--------|-----------|
| Accounts | In-memory placeholders (all) | Real DB accounts + placeholder source if mint is unknown |
| Account selector | Spark + source Cashu only | All user accounts (+ unknown source if applicable) |
| Claim trigger | Guest signup or login redirect | User clicks "Claim" button |
| `claimTo` param | Set before auth handoff | Only present from guest flow |
| Auto-claim in loader | Never | Yes, when `claimTo` is present |
| Token validation | Same hook (mint-only, no auth needed) | Same hook |

## Files

```
app/routes/
├── _public.receive-cashu-token.tsx              # Public entry point
├── _protected.receive.cashu_.token.tsx           # Protected entry point + auto-claim loader

app/features/receive/
├── receive-cashu-token.tsx                       # Both components: PublicReceiveCashuToken, ReceiveCashuToken (default export)
├── receive-cashu-token-hooks.ts                  # useReceiveCashuTokenAccountPlaceholders (public), useReceiveCashuTokenAccounts (protected)
├── receive-cashu-token-models.ts                 # ReceiveCashuTokenAccount, TokenFlags, isClaimingToSameCashuAccount()
└── receive-cashu-token-service.ts                # buildAccountForMint(), getDefaultReceiveAccount()

app/features/user/
└── pending-terms-storage.ts                      # Persists guest terms acceptance timestamp

app/features/signup/
└── accept-terms.tsx                              # Terms acceptance UI (used by public flow)
```
