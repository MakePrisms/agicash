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

## Autonomy

**Ask first:** Tests, browser tools, migrations, installing dependencies.

**Do autonomously:** Read/edit code, run `bun run fix:all`, start dev server if needed.

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

### Authentication Flow
1. Open Secret handles login (email, Google, guest)
2. JWT exchanged for Supabase session token
3. Supabase RLS enforces per-user data access
4. Keys derived client-side, encrypted before storage

**Route layouts:**
- `_protected.tsx` - Requires auth
- `_auth.tsx` - Login/signup (redirects if logged in)
- `_public.tsx` - No auth required

### Encryption
All sensitive data encrypted client-side before storage. Keys derived from Open Secret seed via BIP32. Server never sees plaintext.

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
