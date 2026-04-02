# CLI OpenSecret Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `login`, `signup`, `logout`, and `status` commands to the agicash CLI, wiring OpenSecret auth into the existing command structure, and init a Supabase client authenticated via third-party JWT so the CLI can read/write the same RLS-protected tables as the web app.

**Architecture:** The `@agicash/opensecret-sdk` package (already installed from `MakePrisms/OpenSecret-SDK#dist`) exports headless async functions (`signIn`, `signUp`, `signOut`, `generateThirdPartyToken`, `fetchUser`, `refreshAccessToken`). The CLI already has a SQLite-backed `StorageProvider` (`opensecret-storage.ts`) and conditional `configure()` call. We add an `auth` command group, a `supabase-client.ts` module that calls `generateThirdPartyToken()` → `createClient()`, and require `OPENSECRET_CLIENT_ID` for auth commands. No new dependencies needed — `@supabase/supabase-js` is already in the workspace root.

**Tech Stack:** `@agicash/opensecret-sdk` (headless auth), `@supabase/supabase-js` (DB client), `bun:sqlite` (local token storage via SDK's StorageProvider)

**Branch:** `agicash-cli` (existing)

**Security note:** Password passed as a CLI positional arg is visible in `ps aux` output. This is acceptable for dev/pre-release. Future improvement: read password from stdin prompt (`process.stdin`) when not provided as an arg.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/cli/src/commands/auth.ts` | Create | `login`, `signup`, `logout`, `status` subcommands |
| `packages/cli/src/supabase-client.ts` | Create | Supabase client init with OpenSecret JWT |
| `packages/cli/src/main.ts` | Modify | Add `auth` case, update HELP_TEXT, require OpenSecret for auth commands |
| `packages/cli/src/commands/auth.test.ts` | Create | Tests for auth command validation and output shapes |
| `packages/cli/src/supabase-client.test.ts` | Create | Tests for Supabase client factory |

---

## Reference: SDK API Surface

The CLI imports from `@agicash/opensecret-sdk`:

```typescript
// Already imported in main.ts:
import { configure } from '@agicash/opensecret-sdk';

// New imports needed:
import {
  signIn,           // (email: string, password: string) => Promise<LoginResponse>
  signUp,           // (email: string, password: string, inviteCode: string, name?: string) => Promise<LoginResponse>
  signOut,          // () => Promise<void>
  fetchUser,        // () => Promise<UserResponse>
  generateThirdPartyToken, // (audience?: string) => Promise<{ token: string }>
  refreshAccessToken,      // () => Promise<RefreshResponse>
  isConfigured,     // () => boolean
} from '@agicash/opensecret-sdk';

// Types:
// LoginResponse = { id: string; email?: string; access_token: string; refresh_token: string }
// UserResponse = { user: { id, name, email?, email_verified, login_method, created_at, updated_at } }
// RefreshResponse = { access_token: string; refresh_token: string }
// ThirdPartyTokenResponse = { token: string }
```

The SDK auto-stores tokens in the `StorageProvider` (our SQLite `kv_store` table) after `signIn`/`signUp`/`refreshAccessToken`. No manual token management needed.

**`configure()` must be called before any SDK auth function.** The CLI already does this in `getConfiguredDb()` when `OPENSECRET_CLIENT_ID` is set.

---

## Reference: Existing CLI Patterns

**Command result pattern** (from `commands/config.ts`):
```typescript
export interface AuthResult {
  action: string;
  user?: { id: string; email?: string; /* ... */ };
  error?: string;
  code?: string;
}
```

**main.ts dispatch pattern for auth** (two-phase: sync validation, then async execution):
```typescript
case 'auth': {
  getConfiguredDb(); // ensures configure() is called if OPENSECRET_CLIENT_ID set
  const validation = handleAuthCommand(parsed);
  if (validation.action === 'error') { /* printError + exit */ }
  const result = await executeAuthCommand(parsed);
  if (result.action === 'error') { /* printError + exit */ }
  printOutput(result, outputOptions);
  break;
}
```

**Env vars:** `OPENSECRET_CLIENT_ID` (required for auth), `OPENSECRET_API_URL` (defaults to `https://preview.opensecret.cloud`), `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

---

### Task 1: Auth Command — Input Validation and Structure

**Files:**
- Create: `packages/cli/src/commands/auth.ts`
- Create: `packages/cli/src/commands/auth.test.ts`

This task builds the command structure and validates inputs. `validateAuthArgs` is a pure function that checks arg structure only — no SDK dependency. `handleAuthCommand` adds the config check on top.

- [ ] **Step 1: Write failing tests for auth arg validation**

```typescript
// packages/cli/src/commands/auth.test.ts
import { describe, expect, test } from 'bun:test';
import type { ParsedArgs } from '../args';
import { validateAuthArgs } from './auth';

const makeArgs = (positional: string[], flags: Record<string, string | boolean> = {}): ParsedArgs => ({
  command: 'auth',
  positional,
  flags: { pretty: false, ...flags },
});

describe('auth arg validation', () => {
  test('no subcommand returns error', () => {
    const result = validateAuthArgs(makeArgs([]));
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_SUBCOMMAND');
  });

  test('unknown subcommand returns error', () => {
    const result = validateAuthArgs(makeArgs(['foo']));
    expect(result.action).toBe('error');
    expect(result.code).toBe('UNKNOWN_SUBCOMMAND');
  });

  test('login without email returns error', () => {
    const result = validateAuthArgs(makeArgs(['login']));
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_EMAIL');
  });

  test('login without password returns error', () => {
    const result = validateAuthArgs(makeArgs(['login', 'test@example.com']));
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_PASSWORD');
  });

  test('login with email and password passes validation', () => {
    const result = validateAuthArgs(makeArgs(['login', 'test@example.com', 'pass123']));
    expect(result.action).toBe('validated');
  });

  test('signup without email returns error', () => {
    const result = validateAuthArgs(makeArgs(['signup']));
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_EMAIL');
  });

  test('signup without password returns error', () => {
    const result = validateAuthArgs(makeArgs(['signup', 'test@example.com']));
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_PASSWORD');
  });

  test('signup with email and password passes validation', () => {
    const result = validateAuthArgs(makeArgs(['signup', 'test@example.com', 'pass123']));
    expect(result.action).toBe('validated');
  });

  test('logout passes validation with no extra args', () => {
    const result = validateAuthArgs(makeArgs(['logout']));
    expect(result.action).toBe('validated');
  });

  test('status passes validation with no extra args', () => {
    const result = validateAuthArgs(makeArgs(['status']));
    expect(result.action).toBe('validated');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/cli && bun test src/commands/auth.test.ts`
Expected: FAIL — module `./auth` not found

- [ ] **Step 3: Implement auth command with validation**

```typescript
// packages/cli/src/commands/auth.ts
import {
  fetchUser,
  isConfigured,
  signIn,
  signOut,
  signUp,
} from '@agicash/opensecret-sdk';
import type { ParsedArgs } from '../args';

export type AuthResult = {
  action: string;
  user?: {
    id: string;
    email?: string;
    name?: string | null;
    emailVerified?: boolean;
    loginMethod?: string;
  };
  error?: string;
  code?: string;
};

const VALID_SUBCOMMANDS = ['login', 'signup', 'logout', 'status'] as const;

/**
 * Pure arg validation — no SDK dependency. Tests use this directly.
 */
export function validateAuthArgs(args: ParsedArgs): AuthResult {
  const subcommand = args.positional[0];

  if (!subcommand) {
    return {
      action: 'error',
      error: 'Usage: agicash auth <login|signup|logout|status>',
      code: 'MISSING_SUBCOMMAND',
    };
  }

  if (!VALID_SUBCOMMANDS.includes(subcommand as (typeof VALID_SUBCOMMANDS)[number])) {
    return {
      action: 'error',
      error: `Unknown auth subcommand: ${subcommand}. Use: login, signup, logout, status`,
      code: 'UNKNOWN_SUBCOMMAND',
    };
  }

  if (subcommand === 'login' || subcommand === 'signup') {
    if (!args.positional[1]) {
      return {
        action: 'error',
        error: `Usage: agicash auth ${subcommand} <email> <password>`,
        code: 'MISSING_EMAIL',
      };
    }
    if (!args.positional[2]) {
      return {
        action: 'error',
        error: `Usage: agicash auth ${subcommand} <email> <password>`,
        code: 'MISSING_PASSWORD',
      };
    }
  }

  return { action: 'validated' };
}

/**
 * Full validation: args + OpenSecret config check.
 * Called from main.ts before executeAuthCommand().
 */
export function handleAuthCommand(args: ParsedArgs): AuthResult {
  const argsResult = validateAuthArgs(args);
  if (argsResult.action === 'error') return argsResult;

  if (!isConfigured()) {
    return {
      action: 'error',
      error: 'OpenSecret not configured. Set OPENSECRET_CLIENT_ID in your .env file.',
      code: 'NOT_CONFIGURED',
    };
  }

  return { action: 'validated' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && bun test src/commands/auth.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/auth.ts packages/cli/src/commands/auth.test.ts
git commit -m "feat(cli): add auth command structure with input validation"
```

---

### Task 2: Auth Command — Async Operations (login, signup, logout, status)

**Files:**
- Modify: `packages/cli/src/commands/auth.ts`
- Modify: `packages/cli/src/commands/auth.test.ts`

Add the async `executeAuthCommand()` function that calls SDK functions after validation passes. The `handleAuthCommand` does sync validation; `executeAuthCommand` does the actual SDK calls.

- [ ] **Step 1: Add async execution function to auth.ts**

Add to `packages/cli/src/commands/auth.ts` — a new exported async function:

```typescript
/**
 * Executes the auth command after validation.
 * Call handleAuthCommand() first for sync validation,
 * then this function if validation passed.
 * Precondition: handleAuthCommand() returned { action: 'validated' }.
 */
export async function executeAuthCommand(args: ParsedArgs): Promise<AuthResult> {
  const subcommand = args.positional[0];

  switch (subcommand) {
    case 'login':
    case 'signup': {
      // Safe to assert — handleAuthCommand() validated these exist for login/signup
      const email = args.positional[1] as string;
      const password = args.positional[2] as string;
      return subcommand === 'login'
        ? executeLogin(email, password)
        : executeSignup(email, password);
    }
    case 'logout':
      return executeLogout();
    case 'status':
      return executeStatus();
    default:
      return { action: 'error', error: 'Unknown subcommand', code: 'UNKNOWN_SUBCOMMAND' };
  }
}

async function executeLogin(email: string, password: string): Promise<AuthResult> {
  try {
    const response = await signIn(email, password);
    // SDK auto-stores tokens in StorageProvider
    return {
      action: 'logged_in',
      user: { id: response.id, email: response.email },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Login failed: ${err instanceof Error ? err.message : String(err)}`,
      code: 'LOGIN_FAILED',
    };
  }
}

async function executeSignup(email: string, password: string): Promise<AuthResult> {
  try {
    // Empty invite code — same as the web app
    const response = await signUp(email, password, '');
    return {
      action: 'signed_up',
      user: { id: response.id, email: response.email },
    };
  } catch (err) {
    return {
      action: 'error',
      error: `Signup failed: ${err instanceof Error ? err.message : String(err)}`,
      code: 'SIGNUP_FAILED',
    };
  }
}

async function executeLogout(): Promise<AuthResult> {
  try {
    await signOut();
    return { action: 'logged_out' };
  } catch (err) {
    return {
      action: 'error',
      error: `Logout failed: ${err instanceof Error ? err.message : String(err)}`,
      code: 'LOGOUT_FAILED',
    };
  }
}

async function executeStatus(): Promise<AuthResult> {
  try {
    const { user } = await fetchUser();
    return {
      action: 'authenticated',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.email_verified,
        loginMethod: user.login_method,
      },
    };
  } catch (err) {
    return {
      action: 'not_authenticated',
      error: 'Not logged in. Run: agicash auth login <email> <password>',
      code: 'NOT_AUTHENTICATED',
    };
  }
}
```

- [ ] **Step 2: Run existing tests to make sure nothing broke**

Run: `cd packages/cli && bun test src/commands/auth.test.ts`
Expected: All 10 tests still PASS

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/auth.ts
git commit -m "feat(cli): add async auth execution (login, signup, logout, status)"
```

---

### Task 3: Wire Auth into main.ts

**Files:**
- Modify: `packages/cli/src/main.ts`

Add the `auth` command to the main switch, update HELP_TEXT, and ensure `getConfiguredDb()` is called (which calls `configure()`) before auth commands.

- [ ] **Step 1: Update HELP_TEXT in main.ts**

Add to the `commands` object in `HELP_TEXT`:

```typescript
'auth login <email> <password>': 'Log in with OpenSecret',
'auth signup <email> <password>': 'Create an account',
'auth logout': 'Clear stored credentials',
'auth status': 'Show current auth state',
```

- [ ] **Step 2: Add import and case to main.ts**

Add import at top:
```typescript
import { handleAuthCommand, executeAuthCommand } from './commands/auth';
```

Add case in the switch (before `default`):
```typescript
case 'auth': {
  getConfiguredDb(); // ensures configure() is called
  const validation = handleAuthCommand(parsed);
  if (validation.action === 'error') {
    printError(validation.error ?? '', validation.code ?? '', outputOptions);
    process.exit(1);
  }
  const result = await executeAuthCommand(parsed);
  if (result.action === 'error') {
    printError(result.error ?? '', result.code ?? '', outputOptions);
    process.exit(1);
  }
  printOutput(result, outputOptions);
  break;
}
```

- [ ] **Step 3: Run full test suite to make sure nothing broke**

Run: `cd packages/cli && bun test`
Expected: All 10 auth tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/main.ts
git commit -m "feat(cli): wire auth command into main dispatch"
```

---

### Task 4: Update .env.example

**Files:**
- Modify: `packages/cli/.env.example`

- [ ] **Step 1: Append OpenSecret and Supabase vars to .env.example**

Add to `packages/cli/.env.example`:

```bash
# OpenSecret auth (required for: auth login, auth signup, auth status, cloud sync)
OPENSECRET_CLIENT_ID=
OPENSECRET_API_URL=https://preview.opensecret.cloud

# Supabase (required for cloud sync — same project as the web app)
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/.env.example
git commit -m "feat(cli): add auth + supabase env vars to .env.example"
```

---

### Task 5: Supabase Client with OpenSecret JWT

**Files:**
- Create: `packages/cli/src/supabase-client.ts`
- Create: `packages/cli/src/supabase-client.test.ts`

Create a factory that returns a Supabase client authenticated with the OpenSecret third-party JWT. This mirrors `app/features/agicash-db/database.client.ts` from the web app.

- [ ] **Step 1: Write failing test for supabase env validation**

```typescript
// packages/cli/src/supabase-client.test.ts
import { describe, expect, test } from 'bun:test';
import { validateSupabaseEnv } from './supabase-client';

describe('supabase client config', () => {
  test('validateSupabaseEnv returns error when SUPABASE_URL is missing', () => {
    const result = validateSupabaseEnv({ SUPABASE_ANON_KEY: 'key' });
    expect(result).toEqual({
      ok: false,
      error: 'SUPABASE_URL is required in .env for cloud sync',
    });
  });

  test('validateSupabaseEnv returns error when SUPABASE_ANON_KEY is missing', () => {
    const result = validateSupabaseEnv({ SUPABASE_URL: 'https://x.supabase.co' });
    expect(result).toEqual({
      ok: false,
      error: 'SUPABASE_ANON_KEY is required in .env for cloud sync',
    });
  });

  test('validateSupabaseEnv succeeds with both vars', () => {
    const result = validateSupabaseEnv({
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_ANON_KEY: 'key123',
    });
    expect(result).toEqual({
      ok: true,
      url: 'https://x.supabase.co',
      anonKey: 'key123',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/supabase-client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement supabase-client.ts**

```typescript
// packages/cli/src/supabase-client.ts
import { generateThirdPartyToken } from '@agicash/opensecret-sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type ValidateOk = { ok: true; url: string; anonKey: string };
type ValidateFail = { ok: false; error: string };
type ValidateResult = ValidateOk | ValidateFail;

export function validateSupabaseEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): ValidateResult {
  const url = env.SUPABASE_URL;
  if (!url) {
    return { ok: false, error: 'SUPABASE_URL is required in .env for cloud sync' };
  }
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    return { ok: false, error: 'SUPABASE_ANON_KEY is required in .env for cloud sync' };
  }
  return { ok: true, url, anonKey };
}

let cachedClient: SupabaseClient | null = null;

/**
 * Returns a Supabase client authenticated via OpenSecret's third-party JWT.
 * Requires OpenSecret to be configured and the user to be logged in.
 * The `accessToken` callback calls `generateThirdPartyToken()` on each request,
 * which handles token refresh automatically via the SDK.
 */
export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const env = validateSupabaseEnv();
  if (!env.ok) {
    throw new Error(env.error);
  }

  cachedClient = createClient(env.url, env.anonKey, {
    accessToken: async () => {
      const response = await generateThirdPartyToken();
      return response.token;
    },
    db: { schema: 'wallet' },
  });

  return cachedClient;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun test src/supabase-client.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Verify @supabase/supabase-js is accessible from CLI package**

Run: `cd packages/cli && bun -e "import { createClient } from '@supabase/supabase-js'; console.log('ok')"`

If this fails, add the dependency:
Run: `cd packages/cli && bun add @supabase/supabase-js`

- [ ] **Step 6: Run lint/typecheck**

Run: `cd /Users/claude/agicash && bun run fix:all`
Expected: Clean

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/supabase-client.ts packages/cli/src/supabase-client.test.ts
git commit -m "feat(cli): add Supabase client factory with OpenSecret JWT auth"
```

---

### Task 6: Smoke Test (Manual Verification)

This is a manual verification task — no code changes.

- [ ] **Step 1: Verify help output includes auth commands**

Run: `cd packages/cli && bun run dev help --pretty`
Expected: Output includes `auth login`, `auth signup`, `auth logout`, `auth status`

- [ ] **Step 2: Verify auth login without OPENSECRET_CLIENT_ID gives clear error**

Run: `cd packages/cli && OPENSECRET_CLIENT_ID= bun run dev auth login test@test.com pass123`
Expected: Error with code `NOT_CONFIGURED`

- [ ] **Step 3: Verify auth status without login gives clear error**

Run: `cd packages/cli && bun run dev auth status` (with OPENSECRET_CLIENT_ID set)
Expected: Error with code `NOT_AUTHENTICATED`

- [ ] **Step 4: Verify validation errors**

Run: `cd packages/cli && bun run dev auth login`
Expected: Error with code `MISSING_EMAIL`

Run: `cd packages/cli && bun run dev auth login test@test.com`
Expected: Error with code `MISSING_PASSWORD`

---

## Out of Scope (Future Work)

These are explicitly NOT in this plan:

1. **Syncing local proofs/accounts to Supabase** — that's a separate feature once the Supabase client works
2. **OAuth flows** (Google, GitHub, Apple) — requires browser redirect, not suitable for CLI v1
3. **Password reset** — could add later as `auth reset-password`
4. **Guest accounts** — CLI users should use full accounts
5. **Token refresh command** — SDK handles refresh automatically on 401
6. **Local token inspection** — `auth status` uses `fetchUser()` which is more reliable than decoding JWTs locally
7. **Stdin password prompt** — currently password is a positional arg (visible in `ps`). Future: read from stdin when omitted
