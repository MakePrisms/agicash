# Cashu Lightning Receive (Mint)

Receive Bitcoin via Lightning and mint Cashu proofs.

## Flow

```
1. Get mint quote from mint (POST /v1/mint/quote/bolt11)
   → Returns quoteId, paymentRequest (invoice)
   → Generate lockingDerivationPath for P2PK
2. Share invoice with payer
3. Monitor for payment:
   → WebSocket (NUT-17) if mint supports it
   → Polling fallback (10s interval, 60s on rate limit)
4. When PAID: Generate BlindedMessages from outputAmounts
5. Mint proofs (POST /v1/mint/bolt11)
   → Receive BlindSignatures, unblind to get Proofs
6. Store proofs → COMPLETED
```

## State Machine

```
UNPAID → PAID → COMPLETED (terminal)
    ↓       ↓
  FAILED  FAILED
    ↓
  EXPIRED
```

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
- `CASHU_TOKEN` - Cross-mint receive (melt token on source mint → pay Lightning → mint here)

For `CASHU_TOKEN`, the `tokenReceiveData` field contains `CashuTokenMeltData`:
- `sourceMintUrl`, `tokenProofs`, `meltQuoteId`
- `cashuReceiveFee`, `lightningFeeReserve`, `lightningFee`

## Service Methods

| Method | Transition | Description |
|--------|------------|-------------|
| `createReceiveQuote()` | → UNPAID | Create quote with lockingDerivationPath |
| `completeReceive()` | → COMPLETED | Full flow: UNPAID→PAID→COMPLETED |
| `expire()` | UNPAID → EXPIRED | Mark expired |
| `fail()` | → FAILED | Mark failed with reason |
| `markMeltInitiated()` | - | For CASHU_TOKEN type only |

## Files

```
app/features/receive/
├── cashu-receive-quote.ts           # Type definition
├── cashu-receive-quote-core.ts      # Pure functions (quote creation)
├── cashu-receive-quote-service.ts   # Lifecycle management
├── cashu-receive-quote-repository.ts
└── cashu-receive-quote-hooks.ts
```
