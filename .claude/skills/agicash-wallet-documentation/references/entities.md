# Core Entities

## Overview

Agicash uses three primary entity types for payment operations:

| Entity | Purpose | Lifecycle |
|--------|---------|-----------|
| **Quote** | Payment request lifecycle (mint/melt) | Created → Paid → Minted/Melted |
| **Swap** | Proof exchange operations | Draft → Pending → Completed |
| **Transaction** | User-facing operation record | Draft → Pending → Completed |

## Entity Relationships

```
Transaction (1) ←→ (1) Quote OR Swap
```

- Every Quote or Swap has exactly one Transaction
- Transaction aggregates data from Quote/Swap for UI display
- Transaction provides user-facing state while Quote/Swap handle protocol-level details

## Quote

A **Quote** represents a payment request with the mint for either:
- **Melt Quote** (send): Request to pay a Lightning invoice using ecash
- **Mint Quote** (receive): Request to receive ecash by paying a Lightning invoice

### Types & Locations

| Type | File | Purpose |
|------|------|---------|
| `CashuSendQuote` | `app/features/send/cashu-send-quote.ts` | Melt quote for paying Lightning with Cashu |
| `CashuReceiveQuote` | `app/features/receive/cashu-receive-quote.ts` | Mint quote for receiving Cashu via Lightning |
| `SparkSendQuote` | `app/features/send/spark-send-quote.ts` | Lightning send via Spark wallet |
| `SparkReceiveQuote` | `app/features/receive/spark-receive-quote.ts` | Lightning receive via Spark wallet |

**Read these files for complete type definitions, all fields, and state-specific discriminated union branches.**

### Common State Flow

```
UNPAID → PENDING → PAID/COMPLETED
                 ↓
              FAILED
                 ↓
              EXPIRED
```

States vary by type - see individual type files for exact state machines.

### Key Concepts

- All quotes include `version` for optimistic locking (CRITICAL: always check before updates)
- Discriminated unions enforce state-specific fields (never optional booleans)
- Quote lifecycle managed by service layer (`*-quote-service.ts`)
- Database access through repository layer (`*-quote-repository.ts`)
- React integration via TanStack Query hooks (`*-quote-hooks.ts`)

## Swap

A **Swap** represents proof exchange operations:
- **Send Swap**: Exchange account proofs for sendable proofs (peer-to-peer token creation)
- **Token Swap**: Receive external proofs into account

### Types & Locations

| Type | File | Purpose |
|------|------|---------|
| `CashuSendSwap` | `app/features/send/cashu-send-swap.ts` | Swap account proofs to create sendable token |
| `CashuTokenSwap` | `app/features/receive/cashu-token-swap.ts` | Swap received token proofs into account |

**Read these files for complete type definitions. Note the detailed documentation comments explaining each state.**

### State Flows

**CashuSendSwap:** DRAFT → PENDING → COMPLETED/REVERSED/FAILED

**CashuTokenSwap:** PENDING → COMPLETED/FAILED

See type files for state-specific fields (discriminated unions).

### Key Concepts

- All swaps include `version` for optimistic locking
- Service layer handles mint swap operations (`*-swap-service.ts`)
- Background processing tracks pending swaps to completion
- Repository layer manages persistence (`*-swap-repository.ts`)

## Transaction

A **Transaction** is the user-facing record that aggregates Quote/Swap data for display.

### Type Location

**File:** `app/features/transactions/transaction.ts`

**Read this file for:**
- Complete `Transaction` type definition
- All `details` discriminated union variants (9 different detail types)
- State-specific fields for each transaction type × direction × state combination

### Key Concepts

- Transaction is a complex discriminated union on `type`, `direction`, and `state`
- `details` field shape depends on the specific combination
- Contains user-facing data aggregated from underlying Quote/Swap entities
- Timestamps track lifecycle: `createdAt`, `pendingAt`, `completedAt`, `failedAt`, `reversedAt`

### Related Files

- Repository: `app/features/transactions/transaction-repository.ts`
- Hooks: `app/features/transactions/transaction-hooks.ts`

## Naming Conventions

### Pattern

```
{AccountType}{Operation}{EntityType}
```

Examples:
- `CashuSendQuote` - Cashu account, Send operation, Quote entity
- `SparkReceiveQuote` - Spark account, Receive operation, Quote entity
- `CashuTokenSwap` - Cashu account, Token operation, Swap entity

### File Naming

```
{entity-type}-{operation}-{file-type}.ts
```

Examples:
- `cashu-send-quote-hooks.ts`
- `spark-receive-quote-service.ts`
- `cashu-token-swap-repository.ts`

## Critical Patterns

### Discriminated Unions

All entities use discriminated unions for state-dependent fields:

```typescript
type CashuSendQuote = BaseFields & (
  | { state: 'UNPAID' }
  | { state: 'PENDING' }
  | {
      state: 'PAID';
      paymentPreimage: string;
      amountSpent: Money;
    }
  | {
      state: 'FAILED';
      failureReason: string;
    }
);
```

**Never use optional booleans or flags for state-specific data.** Use discriminated unions to enforce type safety.

### Optimistic Locking

All entities include a `version` field for optimistic concurrency control:

```typescript
type Quote = {
  version: number;
  // ... other fields
}
```

**Always check the version before updates** to prevent race conditions.

### Money Type

All monetary amounts use the `Money` class from `~/lib/money`:

```typescript
import { Money } from '~/lib/money';

// ✓ Correct
Money.fromSats(1000).add(Money.fromSats(500));

// ✗ Wrong - floating point errors
1000 + 500;
```

### Feature Organization

Each feature follows the repository pattern:

```
feature/
├── {entity}-{operation}.ts        # Type definitions
├── {entity}-{operation}-hooks.ts  # TanStack Query hooks
├── {entity}-{operation}-service.ts # Business logic
└── {entity}-{operation}-repository.ts # Database access
```
