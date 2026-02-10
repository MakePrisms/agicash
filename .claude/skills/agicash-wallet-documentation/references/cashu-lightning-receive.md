# Cashu Lightning Receive (Mint)

Receive Bitcoin via Lightning and mint Cashu proofs.

> This document covers two flows: **LIGHTNING** (user shares an invoice, an external payer pays it) and **CASHU_TOKEN** (cross-account receive where the app automatically melts a token on one mint to pay a Lightning invoice on another). Both end with minting proofs on the destination mint, but CASHU_TOKEN is fully automated while LIGHTNING requires an external payment.

## Flow (type: LIGHTNING)

```
1. Create quote
   a) getLightningQuote() → mint quote from mint (POST /v1/mint/quote/bolt11)
      → Returns quoteId, paymentRequest (invoice)
   b) Generate lockingDerivationPath for P2PK
   c) createReceiveQuote() → CashuReceiveQuote in DB (UNPAID) + Transaction record (DRAFT)
2. Share invoice with payer
3. Monitor for payment:
   → WebSocket (NUT-17) if mint supports bolt11_mint_quote command
   → Polling fallback (10s interval, 60s on rate limit) if not
4. When invoice is paid (detected via WebSocket/polling):
   → processPayment() atomically in one DB transaction:
     a) Increment account's keyset counter by number of outputs (reserves counter range)
     b) Record keysetId, keysetCounter (range start), outputAmounts on quote
     c) Transition quote UNPAID → PAID, transaction DRAFT → PENDING
   → Atomicity prevents counter range conflicts on crash/concurrency
5. Generate BlindedMessages deterministically from keysetCounter + outputAmounts
6. Mint proofs (POST /v1/mint/bolt11)
   → Receive BlindSignatures, unblind to get Proofs
7. Store proofs → COMPLETED
```

## Flow (type: CASHU_TOKEN — cross-account receive)

When a Cashu token cannot be claimed via same-mint swap (different mint, different currency, or Spark destination), a Lightning payment is used to move funds from the source mint to the destination account. See `references/cross-account-claim.md` for the full orchestration.

```
1. Create quote
   a) Calculate fees (cashu input fee + Lightning reserve)
   b) Iteratively find valid mint/melt quote pair (up to 5 attempts,
      adjusting amount if fees too high)
   c) Create mint quote on destination mint (POST /v1/mint/quote/bolt11)
   d) Create melt quote on source mint (POST /v1/melt/quote/bolt11)
   e) Create CashuReceiveQuote in DB (UNPAID, type: CASHU_TOKEN)
      + Transaction record (PENDING — payment is guaranteed to be initiated)
2. Initiate melt on source mint (POST /v1/melt/bolt11)
   → Melts token proofs → pays the Lightning invoice
3. markMeltInitiated() → sets meltInitiated=true (tracks that melt was attempted — needed because Cashu has no failed state for melts; if quote reverts to UNPAID with this flag true, the melt failed)
4. When mint quote becomes PAID: Generate BlindedMessages
5. Mint proofs on destination mint (POST /v1/mint/bolt11)
6. Store proofs → COMPLETED
```

**Key differences from LIGHTNING:**
- Transaction starts as PENDING (not DRAFT) since payment is auto-initiated
- `tokenReceiveData` contains melt metadata (see Type Variants below)
- `markMeltInitiated()` prevents duplicate melt attempts on retry/crash recovery
- Total fee = `mintingFee` + `cashuReceiveFee` + `lightningFeeReserve`

**Note:** The cross-account flow also supports **Spark** destinations — in that case a `SparkReceiveQuote` (type: CASHU_TOKEN) is created instead of a `CashuReceiveQuote`. See `references/cross-account-claim.md`.

## State Machine

**States:** UNPAID, EXPIRED, FAILED, PAID, COMPLETED

**Transitions:**
- UNPAID → PAID (invoice paid; processPayment() reserves keyset counter range and records output config)
- UNPAID → EXPIRED (quote past expiresAt)
- UNPAID → FAILED (error during monitoring or melt initiation)
- PAID → COMPLETED (proofs minted and stored)

Note: FAILED is only reachable from UNPAID, not from PAID.

**State-specific fields:**
- PAID/COMPLETED: `keysetId`, `keysetCounter`, `outputAmounts[]`
- FAILED: `failureReason`

## P2PK Locking (NUT-11/NUT-20)

Proofs are locked to a derived public key so only the recipient can spend them.

**Path format:** `m/129372'/0'/0'/{randomUnhardenedIndex}`

- Unhardened last index allows deriving public key from xPub (for quote creation)
- Private key derived from full path to sign unlock (during minting)

## Key Fields

| Field | Description |
|-------|-------------|
| `quoteId` | Mint's quote ID |
| `paymentRequest` | Lightning invoice to share |
| `lockingDerivationPath` | BIP32 path for P2PK key |
| `outputAmounts` | Proof denominations (PAID/COMPLETED only) |
| `mintingFee` | Optional fee charged by mint |

## Type Variants

CashuReceiveQuote has two `type` values:
- `LIGHTNING` - Standard receive via Lightning payment
- `CASHU_TOKEN` - Cross-account receive (melt token on source mint → pay Lightning → mint here)

For `CASHU_TOKEN`, the `tokenReceiveData` field contains `CashuTokenMeltData`:
- `sourceMintUrl`, `tokenProofs`, `meltQuoteId`
- `tokenAmount` (Money — original token value)
- `meltInitiated` (boolean — tracks whether melt was attempted; disambiguates "never triggered" vs "attempted but failed" since Cashu has no failed state for melts)
- `cashuReceiveFee`, `lightningFeeReserve` (required — known at quote creation)
- `lightningFee` (optional — actual fee, set on melt completion)

## Service Methods

| Method | Transition | Description |
|--------|------------|-------------|
| `getLightningQuote()` | (no DB record yet) | Get mint quote and invoice from mint |
| `createReceiveQuote()` | → UNPAID | Create quote with lockingDerivationPath |
| `completeReceive()` | UNPAID → PAID → COMPLETED | Full flow: process payment, mint proofs, store |
| `expire()` | UNPAID → EXPIRED | Mark expired |
| `fail()` | UNPAID → FAILED | Mark failed with reason |
| `markMeltInitiated()` | (flag update) | For CASHU_TOKEN type only — prevents duplicate melt |

## Files

```
app/features/receive/
├── cashu-receive-quote.ts                    # Type definition
├── cashu-receive-quote-core.ts               # Pure functions (quote creation, P2PK derivation)
├── cashu-receive-quote-service.ts            # Lifecycle management
├── cashu-receive-quote-repository.ts
├── cashu-receive-quote-hooks.ts
├── cashu-receive-quote-service.server.ts     # Server-side service (Lightning Address)
├── cashu-receive-quote-repository.server.ts  # Server-side repo (create-only, no decrypt)
└── cashu-token-melt-data.ts                  # CashuTokenMeltData schema (shared with SparkReceiveQuote)
```
