# Cashu Lightning Send (Melt)

Pay a Lightning invoice by melting Cashu proofs.

## Flow

```
1. Get melt quote from mint (POST /v1/melt/quote/bolt11)
   → Returns quoteId, fee_reserve
2. Select proofs >= amount + lightningFeeReserve + cashuFee
3. Create CashuSendQuote (UNPAID), reserve proofs
4. User confirms → Initiate melt (POST /v1/melt/bolt11)
5. Monitor for settlement:
   → WebSocket (NUT-17) if mint supports it
   → Polling fallback
6. Settlement → PAID (with change proofs) or FAILED
```

## State Machine

```
UNPAID → PENDING → PAID (terminal)
    ↓        ↓
  FAILED   FAILED
    ↓
  EXPIRED
```

**State-specific fields:**
- PAID: `paymentPreimage`, `lightningFee`, `amountSpent`, `totalFee`
- FAILED: `failureReason`
- EXPIRED: no extra fields (proofs released, no failure reason)

## Proof Lifecycle

```
UNSPENT → RESERVED (quote created) → SPENT (quote PAID)
                                   → UNSPENT (quote FAILED/EXPIRED)
```
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
change = lightningFeeReserve - lightningFee (returned as proofs)
```

## Service Methods

| Method | Transition | Description |
|--------|------------|-------------|
| `createSendQuote()` | → UNPAID | Create quote, reserve proofs |
| `markSendQuoteAsPending()` | UNPAID → PENDING | Mark melt initiated |
| `completeSendQuote()` | → PAID | Process success, mark proofs SPENT, store change |
| `failSendQuote()` | → FAILED | Release reserved proofs |
| `expireSendQuote()` | UNPAID → EXPIRED | Release reserved proofs (validates expiresAt) |

## Files

```
app/features/send/
├── cashu-send-quote.ts           # Type definition
├── cashu-send-quote-service.ts   # Business logic
├── cashu-send-quote-repository.ts
└── cashu-send-quote-hooks.ts
```
