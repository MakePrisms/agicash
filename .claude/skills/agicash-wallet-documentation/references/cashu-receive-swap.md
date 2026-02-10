# Cashu Token Receive (Swap)

Claim peer-to-peer ecash tokens into a Cashu account.

## Two Paths

### Same Cashu Account → CashuReceiveSwap
Token mint, currency, AND account type all match. Direct swap settles the P2P transfer.

### Different Account → Cross-Account Lightning Payment
Token mint differs, or destination is a different currency or Spark account. Uses a Lightning payment to move funds from the source mint to the destination:
- **Cashu destination**: Creates a CashuReceiveQuote (type: CASHU_TOKEN)
- **Spark destination**: Creates a SparkReceiveQuote (type: CASHU_TOKEN)

See `references/cross-account-claim.md` for the full orchestration.

**Note:** Both paths assume an authenticated user. For how unauthenticated users receive tokens (public route, placeholder accounts, guest signup handoff), see `references/public-token-receive.md`.

## Same-Account Flow

```
1. Parse token (cashuA... or cashuB...)
2. Verify mint + currency + type match destination account
3. Create swap
   a) Create CashuReceiveSwap in DB (PENDING) + Transaction record (PENDING)
      → Keyset counter incremented
      → tokenHash used as unique constraint (prevents duplicate claims)
4. Call mint POST /v1/swap
   → Send tokenProofs as inputs, BlindedMessages as outputs
5. Unblind signatures → new Proofs owned by recipient
6. Store proofs → COMPLETED
```

## State Machine

**States:** PENDING, COMPLETED, FAILED

Created directly in PENDING state. Only 3 states.

**Transitions:**
- PENDING → COMPLETED (swap succeeds, proofs stored)
- PENDING → FAILED (swap fails, e.g. TOKEN_ALREADY_CLAIMED)

**State-specific fields:**
- FAILED: `failureReason`

## Key Fields

| Field | Description |
|-------|-------------|
| `tokenHash` | Hash of received token (identifier + unique constraint) |
| `tokenProofs` | Proofs from token (inputs to swap) |
| `inputAmount` | Sum of tokenProofs |
| `amountReceived` | After fees |
| `feeAmount` | From keyset's `input_fee_ppk` |
| `outputAmounts` | Flat array of output denominations |

## Token Claim Dispatch

`ClaimCashuTokenService.claimToken(user, token, claimTo)` determines which service handles the claim (delegates internally to the private `handleClaim()`):

1. Resolves source account (token's mint) and destination account (user's default, or preferred via `claimTo: 'cashu' | 'spark'`). For unknown mints, `buildAccountForMint()` runs `cashuMintValidator` — if the mint is offline or fails validation, `canReceive` is `false` and it cannot be selected as the destination.
2. If the selected destination is an unknown Cashu mint that passed validation → auto-creates account. If no valid destination exists → claim fails ("Token from this mint cannot be claimed").
3. Routes based on `isClaimingToSameCashuAccount()`:
   - Same type (cashu), same currency, same mint URL → `CashuReceiveSwapService`
   - Otherwise → `ReceiveCashuTokenQuoteService.createCrossAccountReceiveQuotes()`

## Service Methods

| Method | Transition | Description |
|--------|------------|-------------|
| `create()` | → PENDING | Create swap, update keyset counter |
| `completeSwap()` | PENDING → COMPLETED | Execute swap, store proofs |

Note: `fail()` exists on the **repository** only. The service calls it internally when the mint returns TOKEN_ALREADY_CLAIMED.

## Files

```
app/features/receive/
├── cashu-receive-swap.ts                    # Type definition
├── cashu-receive-swap-service.ts            # Swap execution
├── cashu-receive-swap-repository.ts
├── cashu-receive-swap-hooks.ts
├── claim-cashu-token-service.ts             # Token parsing & routing (top-level orchestrator)
├── receive-cashu-token-service.ts           # Account selection & discovery
├── receive-cashu-token-models.ts            # Types: isClaimingToSameCashuAccount(), TokenFlags
└── receive-cashu-token-quote-service.ts     # Cross-account quote creation (fee-fitting loop)
```
