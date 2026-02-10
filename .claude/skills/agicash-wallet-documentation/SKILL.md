---
name: agicash-wallet-documentation
description: Documentation for Agicash wallet transaction flows and entities. Use when modifying send/receive features, working with Quote/Swap/Transaction entities, or understanding payment state machines.
---

# Agicash Wallet Documentation

## Transaction Types

| Type | Direction | Entity | Flow |
|------|-----------|--------|------|
| Cashu Lightning | Send | CashuSendQuote | Melt proofs → pay Lightning invoice |
| Cashu Lightning | Receive | CashuReceiveQuote | Pay Lightning invoice → mint proofs |
| Cashu Token | Send | CashuSendSwap | Swap proofs → encode token → share |
| Cashu Token | Receive | CashuReceiveSwap | Parse token → swap proofs into account |
| Cashu Token | Receive (cross-account) | CashuReceiveQuote or SparkReceiveQuote | Melt from source → Lightning → mint/receive on LN payment completed |
| Spark Lightning | Send | SparkSendQuote | Pay Lightning invoice directly |
| Spark Lightning | Receive | SparkReceiveQuote | Generate invoice → receive payment |
| Lightning Address | Receive | CashuReceiveQuote or SparkReceiveQuote | Server-side: LNURL discovery → invoice → payment |

All operations create a corresponding **Transaction** entity for UI display.

## Core Concepts

### Entities

- **Quote** = Payment request lifecycle (Lightning operations with Cashu mints or Spark)
- **Swap** = Peer-to-peer proof exchange (Cashu tokens)
- **Transaction** = User-facing record (1:1 with Quote or Swap via `transactionId`)
- **Proof** = Cryptographic ecash token with `amount`, `id`, `secret`, `C`

### Cashu Protocol Terms

- **Proof/Input** = Ecash token sent to mint for swap/melt
- **BlindedMessage/Output** = Blinded secret sent to mint for signing
- **BlindSignature/Promise** = Mint's signature, unblinded to get Proof
- **Mint** = Create proofs by paying Lightning
- **Melt** = Spend proofs to pay Lightning
- **Swap** = Exchange proofs for new proofs

## Reference Files

| Flow | Reference |
|------|-----------|
| Entity relationships & cross-cutting patterns | `references/entities.md` |
| Cashu Lightning Send (melt) | `references/cashu-lightning-send.md` |
| Cashu Lightning Receive (mint) | `references/cashu-lightning-receive.md` |
| Cashu Token Send | `references/cashu-send-swap.md` |
| Cashu Token Receive | `references/cashu-receive-swap.md` |
| Spark Lightning (send/receive) | `references/spark-operations.md` |
| Cross-account token claim | `references/cross-account-claim.md` |
| Public token receive (unauthenticated) | `references/public-token-receive.md` |
| Lightning Address (LNURL-pay) | `references/lightning-address.md` |
| Background task processing | `references/task-processing.md` |

## File Structure

```
app/features/{send|receive}/
├── {entity}.ts              # Type definitions (discriminated unions)
├── {entity}-service.ts      # Business logic, state transitions
├── {entity}-repository.ts   # Database access, encryption
└── {entity}-hooks.ts        # TanStack Query hooks
```

**Import hierarchy** (never reverse): `lib/components` → `features` → `routes`

## Key Invariants

1. **All state transitions are idempotent** - safe to retry
2. **All Quote/Swap entities have `version`** - check before updates (optimistic locking). Transaction does not have a version field.
3. **All sensitive data encrypted** - handled transparently by repository
4. **Proofs are RESERVED when quote/swap created** - released on failure/expiry
5. **Only one client runs background tasks** - leader election via `take_lead` RPC
