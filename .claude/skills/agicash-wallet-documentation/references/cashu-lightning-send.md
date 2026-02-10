# Cashu Lightning Send (Melt)

Pay a Lightning invoice by melting Cashu proofs.

## Flow

```
1. Get quote (user picks amount, clicks Continue)
   a) getLightningQuote() → get melt quote from mint (POST /v1/melt/quote/bolt11)
      → Returns quoteId, fee_reserve
   b) Select proofs >= amount + lightningFeeReserve + cashuFee
   → Quote displayed on confirmation screen with fee breakdown
2. Confirm (user reviews fees, clicks Confirm)
   a) createSendQuote() → CashuSendQuote in DB (UNPAID) + Transaction record (PENDING)
      → Proofs marked as RESERVED
      → Keyset counter incremented if change outputs needed
   → User navigated to transaction screen
3. Background processing (automatic, no user action)
   a) useProcessCashuSendQuoteTasks() picks up UNPAID quote
   b) Subscribes to mint WebSocket (NUT-17) for melt quote state
   c) initiateSend() fires melt (POST /v1/melt/bolt11)
   (initiateSend and markAsPending are decoupled — matters for crash recovery)
4. Settlement (via WebSocket state changes):
   → Mint confirms in-progress → markSendQuoteAsPending()
   → PAID: mark proofs SPENT, store change proofs as UNSPENT
   → FAILED: verify with mint first, then release reserved proofs back to UNSPENT
```

## State Machine

**States:** UNPAID, PENDING, EXPIRED, FAILED, PAID

**Transitions:**
- UNPAID → PENDING (mint acknowledges melt in-progress)
- UNPAID → PAID (melt completes before PENDING recorded — crash recovery)
- UNPAID → FAILED (melt rejected)
- UNPAID → EXPIRED (quote past expiresAt)
- PENDING → PAID (melt succeeds)
- PENDING → FAILED (melt fails)

**State-specific fields:**
- PAID: `paymentPreimage`, `lightningFee`, `amountSpent`, `totalFee`
- FAILED: `failureReason`
- EXPIRED: no extra fields (proofs released, no failure reason)

## Proof Lifecycle

**Transitions:**
- UNSPENT → RESERVED (quote created)
- RESERVED → SPENT (quote PAID)
- RESERVED → UNSPENT (quote FAILED/EXPIRED)

Change proofs added as UNSPENT on completion.

## Key Fields

| Field | Description |
|-------|-------------|
| `quoteId` | Mint's melt quote ID |
| `proofs` | Proofs being melted (inputs) |
| `amountReceived` | What recipient gets |
| `lightningFeeReserve` | Max Lightning fee (from quote) |
| `lightningFee` | Actual fee paid (PAID state only) |
| `cashuFee` | Mint's input fee (`input_fee_ppk` from keyset) |

## Fee Calculation

```
totalRequired = amountReceived + lightningFeeReserve + cashuFee
amountSpent = sumProofs(inputProofs) - sumProofs(changeProofs)
```

Change proofs returned by mint account for both fee reserve surplus AND proof denomination overpayment.

## Service Methods

| Method | Transition | Description |
|--------|------------|-------------|
| `getLightningQuote()` | (pre-quote) | Get fee estimate when user clicks Continue |
| `createSendQuote()` | → UNPAID | Create quote, reserve proofs when user clicks Confirm |
| `initiateSend()` | (fires melt) | Background task fires melt (UNPAID required) |
| `markSendQuoteAsPending()` | UNPAID → PENDING | Mint acknowledges melt in-progress |
| `completeSendQuote()` | UNPAID/PENDING → PAID | Process success, mark proofs SPENT, store change |
| `failSendQuote()` | UNPAID/PENDING → FAILED | Verify with mint first, then release reserved proofs |
| `expireSendQuote()` | UNPAID → EXPIRED | Release reserved proofs (validates expiresAt) |

## Files

```
app/features/send/
├── cashu-send-quote.ts           # Type definition
├── cashu-send-quote-service.ts   # Business logic
├── cashu-send-quote-repository.ts
└── cashu-send-quote-hooks.ts
```
