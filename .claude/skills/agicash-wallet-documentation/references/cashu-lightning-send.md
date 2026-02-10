# Cashu Lightning Send (Melt)

Pay a Lightning invoice by melting Cashu proofs.

## Flow

```
1. Create quote
   a) getLightningQuote() → get melt quote from mint (POST /v1/melt/quote/bolt11)
      → Returns quoteId, fee_reserve
   b) Select proofs >= amount + lightningFeeReserve + cashuFee
   c) createSendQuote() → CashuSendQuote in DB (UNPAID) + Transaction record (PENDING)
      → Proofs marked as RESERVED
      → Keyset counter incremented if change outputs needed
2. User confirms → initiateSend() fires melt (POST /v1/melt/bolt11) and returns
3. Monitor for settlement via WebSocket (NUT-17):
   → Mint confirms in-progress → markSendQuoteAsPending()
   (initiateSend and markAsPending are decoupled — matters for crash recovery)
4. Settlement:
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
| `getLightningQuote()` | (pre-quote) | Get fee estimate before user confirms |
| `createSendQuote()` | → UNPAID | Create quote, reserve proofs |
| `initiateSend()` | (fires melt) | Send proofs to mint for melting (UNPAID required) |
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
