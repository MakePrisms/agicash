# CLAUDE.md

## Overview

**Agicash** is a self-custody Bitcoin wallet for Cashu ecash and Lightning payments. Users can send/receive money privately without trusting servers with their keys.

**Core concepts:**
- **Cashu**: Ecash protocol using blind signatures. Mints sign tokens without seeing their content (privacy). Users hold cryptographic proofs that can be transferred peer-to-peer or redeemed.
- **Spark**: Lightning Network SDK for Bitcoin payments
- **Accounts**: Users have Cashu accounts (connected to mints) and Spark accounts (Lightning wallets)

## Working Approach

**Spec-based**: Ask about unclear requirements - don't assume.

**Self-review**: Check your changes for correctness and edge cases before reporting.

**Summarize**: Report files changed, key decisions, and how it works.

**Verify before using**: Before using any function or module — internal or third-party — read its source or type definitions to understand its signature, behavior, and return type. Don't assume based on the name. For third-party packages, check `node_modules/` type declarations. For internal code, read the source file. Never guess at APIs.

## Autonomy

**Ask first:** Installing dependencies, running migrations, destructive operations.

**Do autonomously:** Read/edit code, run tests, use browser tools, run `bun run fix:all`, start dev server.

**After editing TypeScript**: Run `bun run fix:all` to catch type errors before considering the task complete. Don't wait for the user to discover build failures.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React Router v7 (framework mode) |
| Server State | TanStack Query v5 |
| Client State | Zustand |
| Auth | Open Secret → Supabase RLS |
| Styling | Tailwind CSS + shadcn/ui |
| Crypto | @cashu/cashu-ts, @buildonspark/spark-sdk, @noble/* |
| DB | Supabase (PostgreSQL) |

## File Structure

See `GUIDELINES.md` for detailed directory structure and import hierarchy rules.

```
app/
├── routes/           # Filesystem routes (_auth, _protected, _public layouts)
├── features/         # Vertical slices (send/, receive/, accounts/, etc.)
├── components/ui/    # shadcn base components
├── lib/              # Utilities (money/, cashu/, spark/, bolt11/)
└── hooks/            # Shared React hooks
```

**Import hierarchy** (never reverse): `lib/components` → `features` → `routes`

## Key Patterns

### Data Fetching (TanStack Query)
```
feature/
├── *-hooks.ts       # Query hooks (useQuery, useMutation)
├── *-repository.ts  # Database access
└── *-service.ts     # Business logic
```
- Never use `useEffect` for data fetching
- Use `queryOptions()` for reusable configs
- Suspense boundaries for loading states

### Money Handling (CRITICAL)
```ts
import { Money } from '~/lib/money';
// ALWAYS use Money class - never raw arithmetic
const a = new Money({ amount: 1000, currency: 'BTC', unit: 'sat' });
const b = new Money({ amount: 500, currency: 'BTC', unit: 'sat' });
a.add(b); // ✓
1000 + 500; // ✗ floating point errors
```

### Authentication & Encryption

**Open Secret** handles auth (email, Google, guest) and stores the user's BIP39 seed. From this seed, the app derives separate keys for Cashu wallets, Spark wallets, and encryption—all client-side.

**Key constraint:** Private keys never leave the browser. Sensitive data (proofs, transaction details) is encrypted client-side before storage. Server cannot decrypt user data.

**Auth flow:** Open Secret JWT → `generateThirdPartyToken()` → Supabase session → RLS enforcement

**Route layouts:** `_protected.tsx` (requires auth), `_auth.tsx` (login/signup), `_public.tsx` (no auth)

### State Management

| State Type | Use | Example |
|-----------|-----|---------|
| **Multi-step flow** | Zustand store | SendStore, ReceiveStore (persists across pages) |
| **Server data** | TanStack Query | Accounts, User, Transactions (caching, refetch) |
| **Transient UI** | useState | Modal open, animation state |
| **Cache control** | Custom Cache class | CashuSendQuoteCache (version-based updates) |

**Rules:**
- Context is for dependency injection only, not state
- Never use `useEffect` for data fetching - use TanStack Query
- Zustand stores accept dependencies via factory function (`createSendStore(deps)`)
- Use `queryOptions()` for reusable query configs
- Use `useSuspenseQuery` for required data (lets Suspense handle loading)

### Error Handling

**Toast notifications** (Radix UI):
- One toast at a time, 3s duration
- `variant: 'destructive'` for errors
- Use `toast({ description: message })` for simple messages

**Error handling pattern:**
```ts
onError: (error) => {
  if (error instanceof DomainError) {
    toast({ description: error.message }); // User-friendly message
  } else {
    console.error('Failed to X', { cause: error });
    toast({ description: 'Failed to X. Please try again.', variant: 'destructive' });
  }
}
```

**Retry logic** (TanStack Query):
- `DomainError` → never retry (validation/business rule)
- `ConcurrencyError` → always retry
- Network errors → retry once

**Custom error classes** (`app/features/shared/error.ts`):
- `DomainError` - Business rule violations (user-friendly messages)
- `ConcurrencyError` - Optimistic locking failures
- `NotFoundError` - Missing resources

**Background tasks**: Log errors to console but don't show toasts (avoid alert spam).

## Code Standards

- **Files**: kebab-case (`send-quote-hooks.ts`)
- **Types**: Prefer `type` over `interface`
- **Components**: UI only; logic in hooks
- **Validation**: Zod for all inputs
- **Server code**: `*.server.ts` files only

**Avoid:**
- Derived state in useState (calculate instead)
- Props drilling (use context or TanStack Query)
- Components >200 lines (split them)
- Redundant nullish coalescing (`value ?? null` when value is already `T | null`)
- Returning `null` from functions when `undefined` is more idiomatic (avoids `?? undefined` conversions)
- Excessive code duplication - extract common fields into shared objects. Some duplication is OK if it reduces complexity, but large repeated blocks should be refactored
- Over-abstracting simple code into separate files (e.g., inline simple middleware in route files)
- Adding boilerplate that parent components already handle (e.g., child routes don't need `clientLoader.hydrate` if parent layout has it)
- Writing comments that guess at reasons - verify the actual reason first

## Commands

```bash
bun run dev          # Dev server (http://127.0.0.1:3000)
bun run dev --https  # Dev server with HTTPS (https://localhost:3000)
bun run fix:all      # Lint + format + typecheck
bun test             # Unit tests (ask first)
bun run test:e2e     # E2E tests (ask first)
```

**Database**: `bun run db:generate-types` after schema changes (requires migration to be applied first via `supabase db push` or Supabase dashboard)

## Key Files

| Purpose | Location |
|---------|----------|
| Error classes | `app/features/shared/error.ts` - DomainError, ConcurrencyError, NotFoundError |
| Cashu integration | `app/features/shared/cashu.ts` - wallet init, mint validation, cryptography hooks |
| Spark integration | `app/features/shared/spark.ts` - wallet init, balance tracking |
| Encryption | `app/features/shared/encryption.ts` - useEncryption(), client-side encrypt/decrypt |
| Key derivation | `app/features/shared/cryptography.ts` - useCryptography(), BIP32 derivation |
| Account hooks | `app/features/accounts/account-hooks.ts` - useAccounts(), useAccount(), cache |
| Account types | `app/features/accounts/account.ts` - Account, CashuAccount, SparkAccount types |
| Cashu protocol | `app/lib/cashu/` - proof schemas, token parsing, secret handling |
| Common utils | `app/lib/utils.ts` |

## Naming Conventions

**Hooks**: `use{Action}{Entity}` or `use{Entity}`
- `useInitiateCashuSendQuote`, `useAccounts`, `useUser`

**Query options**: `{entity}QueryOptions`
- `accountsQueryOptions`, `userQueryOptions`

**Cache classes**: `{Entity}Cache` with static `Key` property
- `AccountsCache`, `CashuSendQuoteCache`, `TransactionsCache`

**Store files**: `{feature}-store.ts`
- `send-store.ts`, `receive-store.ts`

## Database & Supabase

See `.cursor/rules/` for detailed guidelines:
- `create-migration.mdc` - Migration file naming and structure
- `create-rls-policies.mdc` - Row Level Security patterns
- `create-db-functions.mdc` - Database function conventions
- `postgres-sql-style-guide.mdc` - SQL style (lowercase, comments)
- `writing-supabase-edge-functions.mdc` - Edge function patterns

**Key rules:**
- Always enable RLS on new tables
- Separate policies per operation (select/insert/update/delete) and role (anon/authenticated)
- Migration files: `YYYYMMDDHHmmss_short_description.sql`
- Write SQL in lowercase

**Ask first:**
- Applying local migrations (`supabase migration up`)

**Never do:**
- `supabase db reset` - destroys local database data
- `supabase db push` or any remote database operations
- Drop tables/columns without explicit approval

## Skills

Use these for specialized guidance:
- `/agicash-wallet-documentation` - Send/receive flows, Quote/Swap/Transaction entities, payment logic
- `/cashu-protocol` - Cashu NUT specifications for ecash protocol
- `/design-motion-principles` - Animation and motion design
- `/skill-creator` - Create new Claude Code skills
- `/update-context` - Analyze and update this CLAUDE.md file

## Slash Commands

Utility commands for development:
- `/lnurl-test` - Test Lightning Address server endpoints (LUD-16, LUD-06, LUD-21)
