# Cashu Token Receive (Swap)

Claim peer-to-peer ecash tokens into a Cashu account.

## Two Paths

### Same Mint → CashuReceiveSwap
Token mint matches account mint. Direct swap settles the P2P transfer.

### Different Mint → CashuReceiveQuote (type: CASHU_TOKEN)
Token mint differs from account mint. Uses Lightning bridge:
1. Create mint quote on destination mint
2. Melt token proofs on source mint (pays Lightning invoice)
3. Mint new proofs on destination mint

## Same Mint Flow

```
1. Parse token (cashuA... or cashuB...)
2. Verify mint matches account mint
3. Create swap (PENDING) with tokenProofs as inputs
4. Call mint POST /v1/swap
   → Send tokenProofs as inputs, BlindedMessages as outputs
5. Unblind signatures → new Proofs owned by recipient
6. Store proofs → COMPLETED
```

## State Machine (CashuReceiveSwap)

```
PENDING → COMPLETED
    ↓
  FAILED
```

Only 3 states. Created directly in PENDING.

**State-specific fields:**
- FAILED: `failureReason`

## Key Fields

| Field | Description |
|-------|-------------|
| `tokenHash` | Hash of received token (identifier) |
| `tokenProofs` | Proofs from token (inputs to swap) |
| `inputAmount` | Sum of tokenProofs |
| `amountReceived` | After fees |
| `feeAmount` | From keyset's `input_fee_ppk` |
| `outputAmounts` | Flat array of output denominations |

## Routing Logic

`ClaimCashuTokenService.handleClaim()` routes based on:
- Same account type, currency, AND mint URL → `CashuReceiveSwapService`
- Otherwise → `ReceiveCashuTokenQuoteService.createCrossAccountReceiveQuotes()`

## Service Methods

| Method | Transition | Description |
|--------|------------|-------------|
| `create()` | → PENDING | Create swap, update keyset counter |
| `completeSwap()` | PENDING → COMPLETED | Execute swap, store proofs |
| `fail()` | PENDING → FAILED | Mark failed with reason |

## Files

```
app/features/receive/
├── cashu-receive-swap.ts           # Type definition
├── cashu-receive-swap-service.ts   # Swap execution
├── cashu-receive-swap-repository.ts
├── cashu-receive-swap-hooks.ts
├── claim-cashu-token-service.ts    # Token parsing & routing
└── receive-cashu-token-service.ts  # Account selection
```
