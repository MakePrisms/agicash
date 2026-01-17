---
name: agicash-wallet-documentation
description: Comprehensive documentation for Agicash wallet transaction flows, entities, and business logic. Use when modifying send/receive features, working with Quote/Swap/Transaction entities, understanding payment flows, implementing state transitions, or making changes to business logic in app/features/send, app/features/receive, or app/features/transactions. Essential for understanding the relationships between Cashu ecash operations (quotes, swaps, minting, melting) and Spark Lightning operations.
---

# Agicash Wallet Documentation

## Overview

This skill provides detailed documentation for Agicash wallet's send and receive operations across three transaction types:
- **Cashu Lightning**: Mint ecash from Lightning / Melt ecash to pay Lightning
- **Cashu Token**: Peer-to-peer ecash transfers via encoded tokens
- **Spark Lightning**: Direct Lightning payments (no ecash)

## When to Use This Skill

Use this skill when:
- Modifying send or receive business logic
- Working with Quote, Swap, or Transaction entities
- Understanding state transitions and entity relationships
- Debugging payment flows
- Adding new payment features
- Making changes to repositories, services, or hooks in send/receive features

## Core Concepts

### Entity Types

Read `references/entities.md` first for:
- Overview of Quote vs Swap vs Transaction
- Entity relationships and lifecycle
- Naming conventions
- Critical patterns (discriminated unions, optimistic locking, Money type)
- File organization

**Quick summary:**
- **Quote** = Payment request lifecycle (mint/melt with mint)
- **Swap** = Proof exchange operations
- **Transaction** = User-facing record aggregating Quote/Swap data

## Transaction Type Documentation

Each transaction type × direction has detailed documentation:

### Cashu Lightning

**Send** (Melt ecash to pay Lightning): `references/cashu-lightning-send.md`
- CashuSendQuote entity
- Melt quote flow
- Fee structure (cashuFee + lightningFeeReserve)
- Proof selection and change handling

**Receive** (Mint ecash from Lightning): `references/cashu-lightning-receive.md`
- CashuReceiveQuote entity
- Mint quote flow
- P2PK locking with lockingDerivationPath
- Output amount generation

### Cashu Token

**Send** (Create peer-to-peer token): `references/cashu-token-send.md`
- CashuSendSwap entity
- Proof swapping for exact amounts
- Token encoding and sharing
- Reversal before claim

**Receive** (Claim peer-to-peer token): `references/cashu-token-receive.md`
- Two paths: same-mint swap vs cross-mint Lightning bridge
- CashuTokenSwap for same-mint receives
- CashuReceiveQuote (type: CASHU_TOKEN) for cross-mint
- Token parsing and routing logic

### Spark Lightning

**Both send and receive**: `references/spark-operations.md`
- SparkSendQuote and SparkReceiveQuote entities
- Spark SDK integration
- Direct Lightning (no ecash/proofs)
- Fee estimation vs actual fees
- Real-time payment updates

## How to Use These References

1. **Start with `entities.md`** to understand the three entity types and their relationships

2. **Read the specific transaction type reference** for the flow you're working on

3. **Check the actual type files** referenced in the documentation for:
   - Complete type definitions with all fields
   - State-specific discriminated union branches
   - Inline documentation comments

4. **Follow the file structure** to find service/repository/hooks:
   ```
   app/features/{send|receive}/
   ├── {entity}-{operation}.ts         # **Types**
   ├── {entity}-{operation}-service.ts # Business logic
   ├── {entity}-{operation}-repository.ts # DB access
   └── {entity}-{operation}-hooks.ts   # React/TanStack Query
   ```

## Important Patterns to Follow

### Always Use Discriminated Unions

Never use optional booleans for state-specific data. Use discriminated unions:

```typescript
// ✓ Correct
type Quote = BaseFields & (
  | { state: 'UNPAID' }
  | { state: 'PAID'; preimage: string }
);

// ✗ Wrong
type Quote = {
  state: 'UNPAID' | 'PAID';
  preimage?: string; // Don't do this
};
```

### Always Check Version (Optimistic Locking)

All entities have a `version` field. Always check it before updates to prevent race conditions:

```typescript
await updateQuoteState(quoteId, newState, currentVersion);
```

### Always Use Money Type

Never use raw number arithmetic for monetary amounts:

```typescript
import { Money } from '~/lib/money';

// ✓ Correct
Money.fromSats(1000).add(Money.fromSats(500));

// ✗ Wrong
1000 + 500; // Floating point errors
```

### Follow File Naming Conventions

Pattern: `{account-type}-{operation}-{entity}-{layer}.ts`

Examples:
- `cashu-send-quote-hooks.ts`
- `spark-receive-quote-service.ts`
- `cashu-token-swap-repository.ts`

## Quick Reference Table

| Operation | Direction | Entity | Reference File |
|-----------|-----------|--------|----------------|
| Cashu Lightning | Send | CashuSendQuote | cashu-lightning-send.md |
| Cashu Lightning | Receive | CashuReceiveQuote | cashu-lightning-receive.md |
| Cashu Token | Send | CashuSendSwap | cashu-token-send.md |
| Cashu Token | Receive | CashuTokenSwap or CashuReceiveQuote | cashu-token-receive.md |
| Spark Lightning | Send | SparkSendQuote | spark-operations.md |
| Spark Lightning | Receive | SparkReceiveQuote | spark-operations.md |

All operations create a corresponding Transaction entity (see `app/features/transactions/transaction.ts`).
