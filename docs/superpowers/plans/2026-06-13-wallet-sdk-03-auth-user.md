# Auth + User Domains (`@agicash/wallet-sdk` S3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `auth` and `user` SDK domains: framework-free OpenSecret-wrapped auth operations, the **session resolver** with **ensure-on-resolve** user-row bootstrap (derive keys + default accounts → `upsert_user_with_accounts`), the user repository + `dbUser→User` mapper + user mutations — and wire the real `auth`/`user` domains into `Sdk`, emitting `auth:signed-in` / `auth:signed-out` / `user:updated`.

**Architecture:** The OpenSecret auth functions move behind the SDK's existing `internal/connections/open-secret` seam; the resolver (`domains/user/session-resolver`) is the heart — it reads the `wallet.users` row by the OpenSecret id and, if the row is missing or has drifted (email / emailVerified), derives the three bootstrap keys (cashu locking xpub, encryption pubkey, spark identity pubkey) + builds `account_input[]` from config-supplied defaults and calls the `upsert_user_with_accounts` RPC. Both `auth` sign-in flows (tail) and `user.getCurrentUser()` run this resolver (D2). Domains receive a shared `DomainContext = { config, connections, emitter }` and are built in `Sdk`'s constructor, flipping the `auth`/`user` stubs to real while the other 9 stay `NotImplementedError`.

**Tech Stack:** Bun workspaces, TypeScript 5.9.3, `@agicash/opensecret@1.0.0-rc.0`, `@supabase/supabase-js@2.95.2`, `@agicash/breez-sdk-spark@0.13.5-1` (WASM signer for the spark identity pubkey), `@scure/bip32@1.7.0` + `@scure/bip39@1.6.0` (cashu xpub derivation — **new SDK deps**), `@noble/hashes`, `bun:test`.

---

## Scope boundary (read first)

**In scope (S3):**
- `AuthDomain` impl — `signIn`, `signUp`, `signInGuest`, `signOut`, `refresh`, `resetPassword`, `confirmPasswordReset`, `changePassword`, `upgradeGuest`, `beginGoogleSignIn`, `completeOAuth`, `verifyEmail`, `requestEmailVerificationCode`.
- `UserDomain` impl — `getCurrentUser`, `updateUsername`, `acceptTerms`, `setDefaultCurrency`.
- The **session resolver** + **ensure-on-resolve bootstrap** (D2): drift check, key derivation, default-account → `account_input[]`, `upsert_user_with_accounts`.
- `UserRepository` (get / getByUsername / update / upsert) + `toUser` mapper.
- Guest credential store over `config.storage.persistent`.
- Contract deltas (spec §6) for auth + user + the `user:updated` event (D4).
- `SdkConfig.defaultAccounts` + the `DefaultAccountConfig` type (resolved fork — see Decisions).
- Wiring `auth` + `user` into `Sdk`; events `auth:signed-in` / `auth:signed-out` / `user:updated`.

**Out of scope (later slices):**
- The **`auth:session-expired` timer/emission** — deferred to background/S9 (resolved fork; D10 ties the timer to `background.start/stop`). S3 ships `refresh()` (the primitive S9's timer will call) but no timer.
- The full **accounts** domain — `Account` mapping, decrypt, wallet-init, `accounts.add`, `AddAccountConfig` (S4). S3 builds only a minimal `account_input[]` for bootstrap.
- cashu/spark send-receive (S5/S6), orchestrator (S7), transactions/contacts/transfers (S8), background/realtime (S9), `ServerSdk` (S10), the web cut-over (S11–S15).
- The web stays **untouched** (dark build); S3 is verified by SDK unit tests alone.

---

## Decisions (locked)

- **D3-1 — Default accounts are config-supplied (owner, this session).** `SdkConfig.defaultAccounts?: DefaultAccountConfig[]`. The web assembles the array (keeping its `import.meta.env.MODE` gate web-side when building `SdkConfig`); MCP/server supply their own. The SDK removes all `import.meta.env`. Bootstrap validates ≥1 BTC Spark default before the RPC (mirrors the DB function's own guard).
- **D3-2 — The session-expiry timer is deferred to background/S9 (owner, this session).** S3 implements auth operations + the resolver + `auth:signed-in`/`auth:signed-out`/`user:updated`. The expiry timer + `auth:session-expired` emission ride the `background.start/stop` lifecycle (S9). The web keeps its own `useHandleSessionExpiry` timer until the cut-over (S13), so nothing breaks during the dark build.
- **D3-3 — `getCurrentUser()` IS the resolver (D2).** It runs `isLoggedIn` → `fetchUser()` (OpenSecret identity) → read row by id → drift-check → bootstrap-if-needed → map. Heavier than a plain row read, but spec-mandated and MCP-correct; the web wraps it in a cached TanStack query, amortizing the `fetchUser` cost.
- **D3-4 — OpenSecret auth fns reach the domains via the `internal/connections/open-secret` seam** (re-exported `os*`-aliased). Domains never import `@agicash/opensecret` directly; tests mock the leaf package once.
- **D3-5 — Guest credentials move to `config.storage.persistent`** (key `guestAccount`, JSON `{ id, password }`). Today the web uses raw `localStorage`; routing through the SDK storage provider is the framework-free, MCP-capable form. No zod dep added — the record is hand-validated (zod arrives with the cashu schemas in S5).
- **D3-6 — A minimal `account_input[]` builder lives in S3** (`domains/user/default-accounts.ts`), with `normalizeMintUrl` inlined. The canonical cashu utils + `Account` mappers land in S4/S5; the small overlap is intentional (spec "some duplication OK").
- **CI gate:** `bun run typecheck` + `bun run test` (NOT `fix:all`). Commit per task locally; do not push.

---

## Grounding facts (verified 2026-06-16 — authoritative)

**SDK shapes S3 builds on (from Plan 02, re-verified):**
- `Sdk` (`src/sdk.ts`): `protected constructor(protected readonly config: SdkConfig, protected readonly connections: SdkConnections)`; `static async create(config)` calls `buildConnections(config)`. Domains are field-initialized stubs; `private readonly emitter = new SdkEventEmitter<SdkEventMap>()`, `readonly events = this.emitter`. `destroy()` removes channels + `emitter.removeAll()`.
- `SdkConnections` (`src/internal/connections/index.ts`): `{ supabase: SupabaseClient<Database>; session: SupabaseSessionTokenProvider; realtime: SupabaseRealtimeManager; keys: KeyProvider }`, built by `buildConnections(config)`.
- `KeyProvider` (`src/internal/crypto/keys.ts`): `getChildMnemonic(path): Promise<string>`, `getPrivateKeyBytes(path): Promise<Uint8Array>`, `getPublicKeyHex(path, 'schnorr'|'ecdsa'): Promise<string>`. Path constants: `CASHU_MNEMONIC_PATH = "m/83696968'/39'/0'/12'/0'"`, `SPARK_MNEMONIC_PATH = "m/83696968'/39'/0'/12'/1'"`, `ENCRYPTION_KEY_PATH = "m/10111099'/0'"`.
- `open-secret.ts` exports: `configureOpenSecret(config)`, `isLoggedIn(storage): Promise<boolean>` (reads `access_token`/`refresh_token` from `storage.persistent`, checks refresh `exp`), `generateThirdPartyToken`, `openSecretKeyProvider()`, and a private `decodeJwtExp`.
- `breez.ts` exports: `initBreezWasm()`, `tryInitLogging`, `connectBreez`, `WebAssemblyUnavailableError`. Imports `initWasm (default), connect, defaultConfig, initLogging` from `@agicash/breez-sdk-spark`.
- `crypto/password.ts`: `generateRandomPassword(length = 24): string` (sync, `globalThis.crypto`). `crypto/sha256.ts`: `sha256Hex(message): Promise<string>`.
- `classify(error)` (`src/internal/classify.ts`): `23505` → `DomainError(msg, 'UNIQUE_CONSTRAINT')`; `hint==='CONCURRENCY_ERROR'` → `ConcurrencyError`; `PGRST116` → `NotFoundError`; network → `SdkError('NETWORK_ERROR')`; else `SdkError('UNKNOWN')`; existing `SdkError` passes through.
- `errors.ts`: `SdkError(message, code)`, `ConcurrencyError`, `DomainError`, `NotFoundError`, `NotImplementedError`.
- `User` (`src/types/user.ts`): `FullUser | GuestUser` over `CommonUserData` (`id, username, emailVerified, createdAt, updatedAt, defaultBtcAccountId: string, defaultUsdAccountId: string|null, defaultCurrency: Currency, cashuLockingXpub, encryptionPublicKey, sparkIdentityPublicKey, termsAcceptedAt: string|null, giftCardMintTermsAcceptedAt: string|null`); `FullUser` adds `email: string; isGuest: false`; `GuestUser` adds `isGuest: true`.
- `SparkNetwork` (`src/types/dependencies.ts`): `'MAINNET' | 'REGTEST'`. `AccountPurpose` (`src/types/account.ts`): `'transactional' | 'gift-card' | 'offer'`.

**DB (vendored `src/internal/db/`):**
- `database.ts` exports `AgicashDbUser`, `AgicashDbAccountWithProofs`, and `Database` (overlay narrowing `upsert_user_with_accounts` Args `p_email` → `string | null`, Returns → `{ user: AgicashDbUser; accounts: AgicashDbAccountWithProofs[] }`).
- `users` Row: `cashu_locking_xpub, created_at, default_btc_account_id: string|null, default_currency, default_usd_account_id: string|null, email: string|null, email_verified, encryption_public_key, gift_card_mint_terms_accepted_at: string|null, id, spark_identity_public_key, terms_accepted_at: string|null, updated_at, username`.
- `upsert_user_with_accounts` Args (9): `p_user_id, p_email (string|null), p_email_verified, p_accounts (account_input[]), p_cashu_locking_xpub, p_encryption_public_key, p_spark_identity_public_key, p_terms_accepted_at?, p_gift_card_mint_terms_accepted_at?`. **No `username`** (DB generates it). Re-entry is idempotent (existing accounts kept; `on conflict (id) do update` only updates email + email_verified). Requires ≥1 BTC Spark account.
- `account_input` CompositeType: `{ type, purpose, currency, name, details: Json|null, is_default }`.

**OpenSecret rc surface (verified in `node_modules/@agicash/opensecret/dist/index.d.ts`):**
- `signIn(email, password): Promise<LoginResponse>`; `signUp(email, password, inviteCode, name?): Promise<LoginResponse>`; `signInGuest(id, password): Promise<LoginResponse>`; `signUpGuest(password, inviteCode): Promise<LoginResponse>`; `signOut(): Promise<void>`; `convertGuestToUserAccount(email, password, name?): Promise<void>`; `initiateGoogleAuth(inviteCode?): Promise<{ auth_url, csrf_token }>`; `handleGoogleCallback(code, state, inviteCode): Promise<LoginResponse>`; `requestPasswordReset(email, hashedSecret): Promise<void>`; `confirmPasswordReset(email, alphanumericCode, plaintextSecret, newPassword): Promise<void>`; `verifyEmail(code): Promise<void>`; `requestNewVerificationCode(): Promise<void>`; `changePassword(currentPassword, newPassword): Promise<void>`; `refreshAccessToken(): Promise<{ access_token, refresh_token }>`; `fetchUser(): Promise<UserResponse>`.
- `LoginResponse = { id: string; email?: string; access_token: string; refresh_token: string }`.
- `UserResponse = { user: { id: string; name: string|null; email?: string; email_verified: boolean; login_method: string; created_at: string; updated_at: string } }`.
- The rc persists `access_token`/`refresh_token` in `storage.persistent` (JSDoc on `StorageProvider.persistent`, lines 962–966) — **confirms the SDK `isLoggedIn` assumption; the Plan 11 token-key concern is resolved.**

**Breez WASM signer (verified — for the spark identity pubkey, D3):**
- Package root re-exports the WASM surface (`bundler/index.d.ts`: `export * from "./breez_sdk_spark_wasm.js"`).
- `defaultExternalSigner(mnemonic: string, passphrase: string|null|undefined, network: Network): DefaultSigner`; `Network = "mainnet" | "regtest"`; `DefaultSigner.identityPublicKey(): PublicKeyBytes` (**synchronous** — pure key derivation, no network); `PublicKeyBytes` has `.bytes`. Requires `initBreezWasm()` first; does **not** require `connect()`.

**Web behaviour S3 reproduces (verified, web stays untouched):**
- Drift check (`_protected.tsx` `hasUserChanged`): `(user.isGuest ? null : user.email) !== (authUser.email ?? null) || user.emailVerified !== authUser.email_verified`.
- Bootstrap derivations: encryption pubkey = `getPublicKeyHex(ENCRYPTION_KEY_PATH, 'schnorr')`; cashu locking xpub = `HDKey.fromMasterSeed(mnemonicToSeedSync(getChildMnemonic(CASHU_MNEMONIC_PATH))).derive("m/129372'/0'/0'").publicExtendedKey`; spark identity pubkey = `bytesToHex(defaultExternalSigner(getChildMnemonic(SPARK_MNEMONIC_PATH), null, network).identityPublicKey().bytes)` (network = MAINNET in the web bootstrap, lowercased for breez).
- Guest flow (`signUpGuest`): if a stored guest record exists → `signInGuest(id, password)`; else `generateRandomPassword(32)` → `signUpGuest(password, '')` → store `{ id, password }`.
- `requestPasswordReset`: `secret = generateRandomPassword(20)`; `hash = sha256(secret)`; `requestPasswordReset(email, hash)`; returns the plaintext secret to the caller.
- `toUser(dbUser)`: maps the row; `default_btc_account_id ?? ''`; `dbUser.email` truthy → `FullUser` else `GuestUser`.
- `normalizeMintUrl(url)` (`app/lib/cashu/utils.ts`): `trim` + strip trailing slashes; lowercase scheme + host (preserve path case); fall back to the trimmed string if `new URL` throws.

---

## File Structure

**Modified:**
- `packages/wallet-sdk/src/domains.ts` — amend `AuthDomain` + `UserDomain` (§6 deltas).
- `packages/wallet-sdk/src/events.ts` — add `'user:updated': { user: User }`.
- `packages/wallet-sdk/src/config.ts` — add `defaultAccounts?: DefaultAccountConfig[]` + the `DefaultAccountConfig` type.
- `packages/wallet-sdk/src/index.ts` — export `DefaultAccountConfig`.
- `packages/wallet-sdk/package.json` — add `@scure/bip32@1.7.0`, `@scure/bip39@1.6.0`.
- `packages/wallet-sdk/src/internal/connections/open-secret.ts` — `os*`-aliased auth re-exports + `getCurrentUserId`.
- `packages/wallet-sdk/src/internal/connections/breez.ts` — add `getSparkIdentityPublicKey`.
- `packages/wallet-sdk/src/sdk.ts` — wire real `auth` + `user`.
- `packages/wallet-sdk/src/sdk.test.ts` — fixture gains `defaultAccounts`; assert auth/user are real.

**Created:**
- `packages/wallet-sdk/src/internal/test-support.ts` — `makeFakeDb`, `inMemoryStorage`, `jwtWith` (shared test helpers; not exported from the barrel).
- `packages/wallet-sdk/src/internal/crypto/bootstrap-keys.ts` (+ `.test.ts`) — `deriveCashuLockingXpub`, `deriveEncryptionPublicKey`, `deriveSparkIdentityPublicKey`, `BASE_CASHU_LOCKING_DERIVATION_PATH`.
- `packages/wallet-sdk/src/internal/db/user-mapper.ts` (+ `.test.ts`) — `toUser`.
- `packages/wallet-sdk/src/internal/repositories/user-repository.ts` (+ `.test.ts`) — `UserRepository`, `UpdateUser`, `UpsertUserParams`.
- `packages/wallet-sdk/src/domains/context.ts` — `DomainContext`.
- `packages/wallet-sdk/src/domains/user/default-accounts.ts` (+ `.test.ts`) — `toAccountInput`, `normalizeMintUrl`.
- `packages/wallet-sdk/src/domains/auth/guest-storage.ts` (+ `.test.ts`) — `GuestCredentialStore`.
- `packages/wallet-sdk/src/domains/user/session-resolver.ts` (+ `.test.ts`) — `resolveSession`, `resolveSessionRequired`, `hasUserChanged`.
- `packages/wallet-sdk/src/domains/user/user-domain.ts` (+ `.test.ts`) — `createUserDomain`.
- `packages/wallet-sdk/src/domains/auth/auth-domain.ts` (+ `.test.ts`) — `createAuthDomain`.

---

## Task 1: Contract deltas + config (types only)

**Files:** Modify `src/domains.ts`, `src/events.ts`, `src/config.ts`, `src/index.ts`.

- [ ] **Step 1: Amend `AuthDomain`** in `src/domains.ts` — replace the entire `export interface AuthDomain { … }` block with:

```ts
export interface AuthDomain {
  /** Sign in an existing user with email + password; resolves the wallet user. */
  signIn(params: { email: string; password: string }): Promise<User>;
  /** Create a new full (email) account, bootstrap the user row, and sign in. */
  signUp(params: {
    email: string;
    password: string;
    termsAcceptedAt?: string;
    giftCardMintTermsAcceptedAt?: string;
  }): Promise<User>;
  /** Create or resume an anonymous guest user and sign in. */
  signInGuest(params?: {
    termsAcceptedAt?: string;
    giftCardMintTermsAcceptedAt?: string;
  }): Promise<User>;
  /** Sign out the current user and clear the session. */
  signOut(): Promise<void>;
  /** Refresh the current session/access token (extends the session). */
  refresh(): Promise<void>;
  /** Begin a password reset; the caller holds the returned `secret` for `confirmPasswordReset`. */
  resetPassword(email: string): Promise<{ secret: string }>;
  /** Complete a password reset using the emailed code + the held secret. */
  confirmPasswordReset(params: {
    email: string;
    code: string;
    secret: string;
    newPassword: string;
  }): Promise<void>;
  /** Change the signed-in user's password (requires the current password). */
  changePassword(params: { current: string; new: string }): Promise<void>;
  /** Upgrade the current guest into a full email account, preserving funds/history. */
  upgradeGuest(params: { email: string; password: string }): Promise<User>;
  /**
   * Begin Google OAuth. Returns the URL to redirect the browser to — OAuth is a
   * REDIRECT flow. Web-only; the redirect-state stashing stays consumer-side.
   */
  beginGoogleSignIn(): Promise<{ authUrl: string }>;
  /** Complete OAuth from the redirect callback params; bootstraps + resolves the user. */
  completeOAuth(params: {
    code: string;
    state: string;
    termsAcceptedAt?: string;
    giftCardMintTermsAcceptedAt?: string;
  }): Promise<User>;
  /** Verify the user's email with the emailed code; re-resolves (emailVerified flips). */
  verifyEmail(code: string): Promise<User>;
  /** Resend the email-verification code. */
  requestEmailVerificationCode(): Promise<void>;
}
```

- [ ] **Step 2: Amend `UserDomain`** in `src/domains.ts` — replace the `export interface UserDomain { … }` block with:

```ts
export interface UserDomain {
  /** The currently signed-in user, or null if none. Runs the ensure-on-resolve bootstrap. */
  getCurrentUser(): Promise<User | null>;
  /** Change the user's username. Throws `DomainError` if the username is taken. */
  updateUsername(username: string): Promise<User>;
  /** Record acceptance of the wallet and/or gift-card-mint terms (sets the timestamp(s) to now). */
  acceptTerms(params: { wallet?: boolean; giftCardMint?: boolean }): Promise<User>;
  /** Set the user's preferred display currency. */
  setDefaultCurrency(currency: Currency): Promise<User>;
}
```

- [ ] **Step 3: Add the `user:updated` event** in `src/events.ts` — inside the `SdkEventMap` type, after the `'auth:session-expired'` entry, add:

```ts
  /** The signed-in user's profile changed (username, terms, default currency, email verification). */
  'user:updated': { user: User };
```

(`User` is already imported in `events.ts`.)

- [ ] **Step 4: Add `DefaultAccountConfig` + `defaultAccounts`** in `src/config.ts`. Add imports under the existing `StorageProvider` import:

```ts
import type { AccountPurpose } from './types/account';
import type { Currency } from './types/money';
import type { SparkNetwork } from './types/dependencies';
```

Add the type above `SdkConfig`:

```ts
/**
 * A default account created during user-row bootstrap (the consumer supplies the
 * set; the SDK reads no environment). Mirrors the web's `defaultAccounts`: at
 * least one BTC Spark account is required. Mapped to the DB `account_input`
 * composite by the bootstrap.
 */
export type DefaultAccountConfig =
  | {
      type: 'spark';
      currency: 'BTC';
      name: string;
      network: SparkNetwork;
      purpose: AccountPurpose;
      isDefault: boolean;
    }
  | {
      type: 'cashu';
      currency: Currency;
      name: string;
      mintUrl: string;
      isTestMint: boolean;
      purpose: AccountPurpose;
      isDefault: boolean;
    };
```

Add the field to `SdkConfig` (after `storage`):

```ts
  /**
   * Accounts created at first sign-in (user-row bootstrap). The consumer owns the
   * set (the web gates dev test-mints via `import.meta.env` when assembling this).
   * Required for client mode; bootstrap throws if it lacks a BTC Spark account.
   */
  defaultAccounts?: DefaultAccountConfig[];
```

- [ ] **Step 5: Export `DefaultAccountConfig`** in `src/index.ts` — change `export type { SdkConfig } from './config';` to:

```ts
export type { SdkConfig, DefaultAccountConfig } from './config';
```

- [ ] **Step 6: Verify + commit.** Run `bun run typecheck`. Expected: PASS (the `notImplementedDomain<AuthDomain>` / `<UserDomain>` Proxy stubs still satisfy the widened interfaces; the new event key and optional config field are additive). Run `bun --filter=@agicash/wallet-sdk run test`. Expected: PASS (existing tests unaffected).

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): apply §6 auth/user contract deltas + defaultAccounts config

Widen AuthDomain (verifyEmail, two-step password reset, terms params, OAuth
params) and UserDomain (acceptTerms, setDefaultCurrency); add the user:updated
event and SdkConfig.defaultAccounts (DefaultAccountConfig). Types only — domains
stay stubbed; gate stays green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: OpenSecret auth re-exports + `getCurrentUserId`

**Files:** Modify `src/internal/connections/open-secret.ts`; create `src/internal/connections/open-secret-auth.test.ts`.

- [ ] **Step 1: Extend the OpenSecret import** in `open-secret.ts` — the file currently imports `{ configure, generateThirdPartyToken, getPrivateKey, getPrivateKeyBytes, getPublicKey, type StorageProvider }`. Leave that, and add the auth re-export block + `getCurrentUserId` at the end of the file:

```ts
/** OpenSecret auth operations, re-exported `os*`-aliased so domains never import
 * `@agicash/opensecret` directly (single seam; one module to mock in tests). */
export {
  signIn as osSignIn,
  signUp as osSignUp,
  signInGuest as osSignInGuest,
  signUpGuest as osSignUpGuest,
  signOut as osSignOut,
  convertGuestToUserAccount as osConvertGuestToUserAccount,
  initiateGoogleAuth as osInitiateGoogleAuth,
  handleGoogleCallback as osHandleGoogleCallback,
  requestPasswordReset as osRequestPasswordReset,
  confirmPasswordReset as osConfirmPasswordReset,
  verifyEmail as osVerifyEmail,
  requestNewVerificationCode as osRequestNewVerificationCode,
  changePassword as osChangePassword,
  refreshAccessToken as osRefreshAccessToken,
  fetchUser,
} from '@agicash/opensecret';
export type { LoginResponse, UserResponse } from '@agicash/opensecret';

/** Extract a JWT's `sub` (user id) from its base64url payload, no deps. */
function decodeJwtSub(jwt: string): string | undefined {
  const segment = jwt.split('.')[1];
  if (!segment) {
    return undefined;
  }
  try {
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
    const { sub } = JSON.parse(atob(padded)) as { sub?: string };
    return sub;
  } catch {
    return undefined;
  }
}

/** The signed-in user's id, read from the persisted access token (no network). */
export async function getCurrentUserId(
  storage: StorageProvider,
): Promise<string | null> {
  const accessToken = await storage.persistent.getItem('access_token');
  if (!accessToken) {
    return null;
  }
  return decodeJwtSub(accessToken) ?? null;
}
```

- [ ] **Step 2: Write the failing test** (`open-secret-auth.test.ts`):

```ts
import { describe, expect, it } from 'bun:test';
import type { SdkConfig } from '../../config';
import { getCurrentUserId } from './open-secret';

function fakeStorage(tokens: Record<string, string>): SdkConfig['storage'] {
  const kv = {
    getItem: (k: string) => tokens[k] ?? null,
    setItem: () => {},
    removeItem: () => {},
  };
  return { persistent: kv, session: kv } as unknown as SdkConfig['storage'];
}
function jwtWithSub(sub: string): string {
  return `h.${btoa(JSON.stringify({ sub })).replace(/=/g, '')}.s`;
}

describe('getCurrentUserId', () => {
  it('decodes the sub claim from the access token', async () => {
    const storage = fakeStorage({ access_token: jwtWithSub('user-123') });
    expect(await getCurrentUserId(storage)).toBe('user-123');
  });
  it('returns null when no access token is present', async () => {
    expect(await getCurrentUserId(fakeStorage({}))).toBeNull();
  });
  it('returns null for a malformed token', async () => {
    const storage = fakeStorage({ access_token: 'not-a-jwt' });
    expect(await getCurrentUserId(storage)).toBeNull();
  });
});
```

- [ ] **Step 3: Run + verify.** `bun --filter=@agicash/wallet-sdk run test` → the new `getCurrentUserId` cases PASS. `bun run typecheck` → PASS (the `os*` re-exports resolve against the rc).

- [ ] **Step 4: Commit.**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): OpenSecret auth re-exports + getCurrentUserId

Re-export the OpenSecret auth operations (os*-aliased) through the connection
seam and add getCurrentUserId (decodes the access-token sub). Domains consume
auth via this single module.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Spark identity pubkey (`breez.ts`)

**Files:** Modify `src/internal/connections/breez.ts`, `src/internal/connections/breez.test.ts`.

- [ ] **Step 1: Add the import + helper** in `breez.ts`. Change the top import to add `defaultExternalSigner` and the `Network` type, and add a `bytesToHex` import:

```ts
import initWasm, {
  type BreezSdk,
  type Network,
  connect,
  defaultConfig,
  defaultExternalSigner,
  initLogging,
} from '@agicash/breez-sdk-spark';
import { bytesToHex } from '@noble/hashes/utils';
```

Add at the end of the file:

```ts
/**
 * Derives the Spark identity public key (hex) for a BIP39 mnemonic. Initializes
 * the Breez WASM module first (the signer is WASM-backed); `identityPublicKey()`
 * itself is a synchronous, network-free key derivation — NO `connect()` needed.
 *
 * @param mnemonic - The Spark wallet BIP39 mnemonic (BIP-85 child).
 * @param network - Breez network (`'mainnet'` | `'regtest'`).
 * @returns The identity public key as a lowercase hex string.
 */
export async function getSparkIdentityPublicKey(
  mnemonic: string,
  network: Network,
): Promise<string> {
  await initBreezWasm();
  const signer = defaultExternalSigner(mnemonic, null, network);
  return bytesToHex(new Uint8Array(signer.identityPublicKey().bytes));
}
```

- [ ] **Step 2: Extend the test mock + add a case** in `breez.test.ts`. Add `defaultExternalSigner` to the existing `mock.module('@agicash/breez-sdk-spark', () => ({ … }))` factory:

```ts
  defaultExternalSigner: (
    _mnemonic: string,
    _passphrase: string | null | undefined,
    _network: string,
  ) => ({
    identityPublicKey: () => ({ bytes: new Uint8Array([1, 2, 3, 4]) }),
  }),
```

Add `getSparkIdentityPublicKey` to the destructured import: `const { initBreezWasm, tryInitLogging, connectBreez, getSparkIdentityPublicKey } = await import('./breez');`

Add a describe block:

```ts
describe('getSparkIdentityPublicKey', () => {
  it('returns the signer identity public key as hex (after WASM init)', async () => {
    const hex = await getSparkIdentityPublicKey(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      'mainnet',
    );
    expect(hex).toBe('01020304');
  });
});
```

- [ ] **Step 3: Run + verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): getSparkIdentityPublicKey via Breez WASM signer

Derive the spark identity pubkey from a mnemonic using defaultExternalSigner
(WASM init, no connect). Needed by the user-row bootstrap (D3: SDK owns key
derivation incl. the spark identity).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Bootstrap key derivation (`bootstrap-keys.ts`)

**Files:** Modify `packages/wallet-sdk/package.json`; create `src/internal/crypto/bootstrap-keys.ts` + `.test.ts`.

- [ ] **Step 1: Add deps + install.** In `packages/wallet-sdk/package.json` `dependencies`, add `"@scure/bip32": "1.7.0"` and `"@scure/bip39": "1.6.0"` (matching the web). Run `bun install`. Expected: resolves from the workspace (already in `node_modules`), updates `bun.lock`.

- [ ] **Step 2: Implement** (`src/internal/crypto/bootstrap-keys.ts`):

```ts
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { getSparkIdentityPublicKey } from '../connections/breez';
import type { Network } from '@agicash/breez-sdk-spark';
import {
  CASHU_MNEMONIC_PATH,
  ENCRYPTION_KEY_PATH,
  type KeyProvider,
  SPARK_MNEMONIC_PATH,
} from './keys';

/** BIP-32 path the cashu locking xpub is derived at (NUT-13: 129372 = 🥜). */
export const BASE_CASHU_LOCKING_DERIVATION_PATH = "m/129372'/0'/0'";

/**
 * The extended public key the mint uses to lock cashu quotes to this user.
 * Derived from the cashu BIP-85 child mnemonic → seed → BIP-32 xpub.
 */
export async function deriveCashuLockingXpub(keys: KeyProvider): Promise<string> {
  const mnemonic = await keys.getChildMnemonic(CASHU_MNEMONIC_PATH);
  const seed = mnemonicToSeedSync(mnemonic);
  const node = HDKey.fromMasterSeed(seed).derive(
    BASE_CASHU_LOCKING_DERIVATION_PATH,
  );
  return node.publicExtendedKey;
}

/** The schnorr public key used to encrypt the user's data at rest. */
export async function deriveEncryptionPublicKey(
  keys: KeyProvider,
): Promise<string> {
  return keys.getPublicKeyHex(ENCRYPTION_KEY_PATH, 'schnorr');
}

/** The Spark identity public key, derived from the spark BIP-85 child mnemonic. */
export async function deriveSparkIdentityPublicKey(
  keys: KeyProvider,
  network: Network,
): Promise<string> {
  const mnemonic = await keys.getChildMnemonic(SPARK_MNEMONIC_PATH);
  return getSparkIdentityPublicKey(mnemonic, network);
}
```

- [ ] **Step 3: Write the test** (`bootstrap-keys.test.ts`). Mock breez (the spark identity path) and use a stub `KeyProvider`:

```ts
import { describe, expect, it, mock } from 'bun:test';

mock.module('@agicash/breez-sdk-spark', () => ({
  default: async () => {},
  defaultExternalSigner: () => ({
    identityPublicKey: () => ({ bytes: new Uint8Array([9, 9, 9]) }),
  }),
}));

const {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  deriveCashuLockingXpub,
  deriveEncryptionPublicKey,
  deriveSparkIdentityPublicKey,
} = await import('./bootstrap-keys');
import type { KeyProvider } from './keys';

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function stubKeys(overrides: Partial<KeyProvider> = {}): KeyProvider {
  return {
    getChildMnemonic: async () => TEST_MNEMONIC,
    getPrivateKeyBytes: async () => new Uint8Array(32),
    getPublicKeyHex: async () => `02${'11'.repeat(32)}`,
    ...overrides,
  };
}

describe('bootstrap-keys', () => {
  it('uses the canonical cashu locking derivation path', () => {
    expect(BASE_CASHU_LOCKING_DERIVATION_PATH).toBe("m/129372'/0'/0'");
  });

  it('derives a deterministic cashu locking xpub from the child mnemonic', async () => {
    const a = await deriveCashuLockingXpub(stubKeys());
    const b = await deriveCashuLockingXpub(stubKeys());
    expect(a).toBe(b);
    expect(a.startsWith('xpub')).toBe(true);
  });

  it('passes the cashu BIP-85 path to the key provider', async () => {
    let seen = '';
    await deriveCashuLockingXpub(
      stubKeys({
        getChildMnemonic: async (p) => {
          seen = p;
          return TEST_MNEMONIC;
        },
      }),
    );
    expect(seen).toBe("m/83696968'/39'/0'/12'/0'");
  });

  it('derives the encryption public key via getPublicKeyHex(schnorr)', async () => {
    let seenPath = '';
    let seenAlgo = '';
    const pub = await deriveEncryptionPublicKey(
      stubKeys({
        getPublicKeyHex: async (path, algo) => {
          seenPath = path;
          seenAlgo = algo;
          return 'ENC_PUB';
        },
      }),
    );
    expect(pub).toBe('ENC_PUB');
    expect(seenPath).toBe("m/10111099'/0'");
    expect(seenAlgo).toBe('schnorr');
  });

  it('derives the spark identity pubkey from the spark BIP-85 child mnemonic', async () => {
    let seen = '';
    const hex = await deriveSparkIdentityPublicKey(
      stubKeys({
        getChildMnemonic: async (p) => {
          seen = p;
          return TEST_MNEMONIC;
        },
      }),
      'mainnet',
    );
    expect(seen).toBe("m/83696968'/39'/0'/12'/1'");
    expect(hex).toBe('090909');
  });
});
```

- [ ] **Step 4: Run + verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): bootstrap key derivation (cashu xpub, encryption, spark id)

Add @scure/bip32 + @scure/bip39 and derive the three keys the user-row bootstrap
feeds to upsert_user_with_accounts: cashu locking xpub (mnemonic→seed→BIP-32),
encryption pubkey (schnorr), spark identity pubkey (WASM signer).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `dbUser → User` mapper (`user-mapper.ts`)

**Files:** Create `src/internal/db/user-mapper.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/internal/db/user-mapper.ts`):

```ts
import type { User } from '../../types/user';
import type { AgicashDbUser } from './database';

/**
 * Maps a `wallet.users` row to the domain {@link User}. Guest vs full is
 * determined purely by email presence; a null `default_btc_account_id` maps to
 * the empty string (matches master's `ReadUserRepository.toUser`).
 */
export function toUser(dbUser: AgicashDbUser): User {
  const common = {
    id: dbUser.id,
    username: dbUser.username,
    emailVerified: dbUser.email_verified,
    createdAt: dbUser.created_at,
    updatedAt: dbUser.updated_at,
    cashuLockingXpub: dbUser.cashu_locking_xpub,
    encryptionPublicKey: dbUser.encryption_public_key,
    sparkIdentityPublicKey: dbUser.spark_identity_public_key,
    defaultBtcAccountId: dbUser.default_btc_account_id ?? '',
    defaultUsdAccountId: dbUser.default_usd_account_id,
    defaultCurrency: dbUser.default_currency,
    termsAcceptedAt: dbUser.terms_accepted_at,
    giftCardMintTermsAcceptedAt: dbUser.gift_card_mint_terms_accepted_at,
  };

  if (dbUser.email) {
    return { ...common, email: dbUser.email, isGuest: false };
  }
  return { ...common, isGuest: true };
}
```

- [ ] **Step 2: Write the test** (`user-mapper.test.ts`):

```ts
import { describe, expect, it } from 'bun:test';
import type { AgicashDbUser } from './database';
import { toUser } from './user-mapper';

function row(overrides: Partial<AgicashDbUser> = {}): AgicashDbUser {
  return {
    id: 'u1',
    username: 'alice',
    email: null,
    email_verified: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    cashu_locking_xpub: 'xpub-1',
    encryption_public_key: 'enc-1',
    spark_identity_public_key: 'spark-1',
    default_btc_account_id: 'btc-acc',
    default_usd_account_id: null,
    default_currency: 'BTC',
    terms_accepted_at: null,
    gift_card_mint_terms_accepted_at: null,
    ...overrides,
  } as AgicashDbUser;
}

describe('toUser', () => {
  it('maps a full (email) user → FullUser', () => {
    const user = toUser(row({ email: 'a@b.co', email_verified: true }));
    expect(user.isGuest).toBe(false);
    if (!user.isGuest) {
      expect(user.email).toBe('a@b.co');
    }
    expect(user.emailVerified).toBe(true);
    expect(user.defaultBtcAccountId).toBe('btc-acc');
  });

  it('maps an emailless row → GuestUser', () => {
    const user = toUser(row({ email: null }));
    expect(user.isGuest).toBe(true);
  });

  it('coerces a null default_btc_account_id to empty string', () => {
    const user = toUser(row({ default_btc_account_id: null }));
    expect(user.defaultBtcAccountId).toBe('');
  });
});
```

- [ ] **Step 3: Run + verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): dbUser→User mapper

Port ReadUserRepository.toUser: wallet.users row → domain User (guest vs full by
email presence; null default_btc_account_id → '').

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: User repository (`user-repository.ts`) + test support

**Files:** Create `src/internal/test-support.ts`, `src/internal/repositories/user-repository.ts` + `.test.ts`.

- [ ] **Step 1: Create the shared test helpers** (`src/internal/test-support.ts`):

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SdkConfig } from '../config';
import type { Database } from './db/database';

type DbResult = { data: unknown; error: unknown };

/**
 * A minimal fake Supabase client for repository/domain unit tests. `from(table)`
 * returns a chainable builder whose `single()`/`maybeSingle()` resolve to
 * `selectResult`; `rpc(name, args)` records the call and resolves to `rpcResult`.
 */
export function makeFakeDb(opts: {
  selectResult?: DbResult;
  updateResult?: DbResult;
  rpcResult?: DbResult;
  calls?: {
    from?: string[];
    update?: unknown[];
    rpc?: Array<{ name: string; args: unknown }>;
  };
}): SupabaseClient<Database> {
  const select = opts.selectResult ?? { data: null, error: null };
  const update = opts.updateResult ?? { data: null, error: null };
  const builder = (terminal: () => Promise<DbResult>) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
    b['update'] = (payload: unknown) => {
      opts.calls?.update?.push(payload);
      return updateBuilder();
    };
    b['single'] = terminal;
    b['maybeSingle'] = terminal;
    return b;
  };
  const updateBuilder = () => builder(async () => update);
  return {
    from: (table: string) => {
      opts.calls?.from?.push(table);
      return builder(async () => select);
    },
    rpc: async (name: string, args: unknown) => {
      opts.calls?.rpc?.push({ name, args });
      return opts.rpcResult ?? { data: null, error: null };
    },
  } as unknown as SupabaseClient<Database>;
}

/** An in-memory `StorageProvider` (persistent + session share one map). */
export function inMemoryStorage(
  seed: Record<string, string> = {},
): SdkConfig['storage'] {
  const map = new Map<string, string>(Object.entries(seed));
  const kv = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  return { persistent: kv, session: kv } as unknown as SdkConfig['storage'];
}

/** Build a fake JWT carrying the given claims (header/sig are dummy). */
export function jwtWith(claims: { sub?: string; exp?: number }): string {
  return `h.${btoa(JSON.stringify(claims)).replace(/=/g, '')}.s`;
}
```

- [ ] **Step 2: Implement the repository** (`src/internal/repositories/user-repository.ts`):

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { SdkError } from '../../errors';
import type { Currency } from '../../types/money';
import type { User } from '../../types/user';
import { classify } from '../classify';
import type { Database } from '../db/database';
import { toUser } from '../db/user-mapper';

type AccountInput = Database['wallet']['CompositeTypes']['account_input'];

/** Partial profile update; only the provided fields are written. */
export type UpdateUser = {
  defaultBtcAccountId?: string;
  defaultUsdAccountId?: string | null;
  defaultCurrency?: Currency;
  username?: string;
  termsAcceptedAt?: string;
  giftCardMintTermsAcceptedAt?: string;
};

/** Full user-row bootstrap payload for `upsert_user_with_accounts`. */
export type UpsertUserParams = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  accounts: AccountInput[];
  cashuLockingXpub: string;
  encryptionPublicKey: string;
  sparkIdentityPublicKey: string;
  termsAcceptedAt?: string;
  giftCardMintTermsAcceptedAt?: string;
};

/** Data access for the `wallet.users` row. Stateless; wraps the RLS client. */
export class UserRepository {
  constructor(private readonly db: SupabaseClient<Database>) {}

  /** The user with this id, or null if the row does not exist. */
  async get(userId: string): Promise<User | null> {
    const { data, error } = await this.db
      .from('users')
      .select()
      .eq('id', userId)
      .maybeSingle();
    if (error) throw classify(error);
    return data ? toUser(data) : null;
  }

  /** The user with this username, or null if none. */
  async getByUsername(username: string): Promise<User | null> {
    const { data, error } = await this.db
      .from('users')
      .select()
      .eq('username', username)
      .maybeSingle();
    if (error) throw classify(error);
    return data ? toUser(data) : null;
  }

  /** Apply a partial profile update; throws `DomainError` on a taken username. */
  async update(userId: string, data: UpdateUser): Promise<User> {
    const payload: Database['wallet']['Tables']['users']['Update'] = {};
    if (data.defaultBtcAccountId !== undefined)
      payload.default_btc_account_id = data.defaultBtcAccountId;
    if (data.defaultUsdAccountId !== undefined)
      payload.default_usd_account_id = data.defaultUsdAccountId;
    if (data.defaultCurrency !== undefined)
      payload.default_currency = data.defaultCurrency;
    if (data.username !== undefined) payload.username = data.username;
    if (data.termsAcceptedAt !== undefined)
      payload.terms_accepted_at = data.termsAcceptedAt;
    if (data.giftCardMintTermsAcceptedAt !== undefined)
      payload.gift_card_mint_terms_accepted_at = data.giftCardMintTermsAcceptedAt;

    const { data: row, error } = await this.db
      .from('users')
      .update(payload)
      .eq('id', userId)
      .select()
      .single();
    if (error) throw classify(error);
    if (!row) throw new SdkError('User update returned no row', 'UPDATE_FAILED');
    return toUser(row);
  }

  /** Ensure-on-resolve bootstrap: derive-keys + default accounts → user row. */
  async upsert(params: UpsertUserParams): Promise<User> {
    const args: Database['wallet']['Functions']['upsert_user_with_accounts']['Args'] =
      {
        p_user_id: params.id,
        p_email: params.email,
        p_email_verified: params.emailVerified,
        p_accounts: params.accounts,
        p_cashu_locking_xpub: params.cashuLockingXpub,
        p_encryption_public_key: params.encryptionPublicKey,
        p_spark_identity_public_key: params.sparkIdentityPublicKey,
      };
    if (params.termsAcceptedAt != null)
      args.p_terms_accepted_at = params.termsAcceptedAt;
    if (params.giftCardMintTermsAcceptedAt != null)
      args.p_gift_card_mint_terms_accepted_at = params.giftCardMintTermsAcceptedAt;

    const { data, error } = await this.db.rpc(
      'upsert_user_with_accounts',
      args,
    );
    if (error) throw classify(error);
    if (!data?.user)
      throw new SdkError(
        'upsert_user_with_accounts returned no user',
        'UPSERT_FAILED',
      );
    return toUser(data.user);
  }
}
```

- [ ] **Step 3: Write the test** (`user-repository.test.ts`) — includes the **taken-username → `DomainError` regression**:

```ts
import { describe, expect, it } from 'bun:test';
import { DomainError } from '../../errors';
import { makeFakeDb } from '../test-support';
import { UserRepository } from './user-repository';

const dbRow = {
  id: 'u1',
  username: 'alice',
  email: 'a@b.co',
  email_verified: true,
  created_at: 't',
  updated_at: 't',
  cashu_locking_xpub: 'x',
  encryption_public_key: 'e',
  spark_identity_public_key: 's',
  default_btc_account_id: 'btc',
  default_usd_account_id: null,
  default_currency: 'BTC',
  terms_accepted_at: null,
  gift_card_mint_terms_accepted_at: null,
};

describe('UserRepository', () => {
  it('get() maps a row → User and queries the users table', async () => {
    const calls = { from: [] as string[] };
    const repo = new UserRepository(
      makeFakeDb({ selectResult: { data: dbRow, error: null }, calls }),
    );
    const user = await repo.get('u1');
    expect(user?.id).toBe('u1');
    expect(calls.from).toContain('users');
  });

  it('get() returns null when the row is absent', async () => {
    const repo = new UserRepository(
      makeFakeDb({ selectResult: { data: null, error: null } }),
    );
    expect(await repo.get('missing')).toBeNull();
  });

  it('update() rejects with DomainError on a unique-violation (taken username)', async () => {
    const repo = new UserRepository(
      makeFakeDb({
        updateResult: {
          data: null,
          error: { code: '23505', message: 'duplicate key' },
        },
      }),
    );
    await expect(repo.update('u1', { username: 'taken' })).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it('update() sends only the provided fields', async () => {
    const calls = { update: [] as unknown[] };
    const repo = new UserRepository(
      makeFakeDb({ updateResult: { data: dbRow, error: null }, calls }),
    );
    await repo.update('u1', { username: 'bob' });
    expect(calls.update[0]).toEqual({ username: 'bob' });
  });

  it('upsert() calls the RPC with the full 9-arg payload and maps the result', async () => {
    const calls = { rpc: [] as Array<{ name: string; args: unknown }> };
    const repo = new UserRepository(
      makeFakeDb({
        rpcResult: { data: { user: dbRow, accounts: [] }, error: null },
        calls,
      }),
    );
    const user = await repo.upsert({
      id: 'u1',
      email: 'a@b.co',
      emailVerified: true,
      accounts: [],
      cashuLockingXpub: 'xpub',
      encryptionPublicKey: 'enc',
      sparkIdentityPublicKey: 'spark',
      termsAcceptedAt: '2026-06-16T00:00:00Z',
    });
    expect(user.id).toBe('u1');
    expect(calls.rpc[0]?.name).toBe('upsert_user_with_accounts');
    const args = calls.rpc[0]?.args as Record<string, unknown>;
    expect(args.p_user_id).toBe('u1');
    expect(args.p_cashu_locking_xpub).toBe('xpub');
    expect(args.p_spark_identity_public_key).toBe('spark');
    expect(args.p_terms_accepted_at).toBe('2026-06-16T00:00:00Z');
    expect('p_gift_card_mint_terms_accepted_at' in args).toBe(false);
  });
});
```

- [ ] **Step 4: Run + verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): user repository (get/getByUsername/update/upsert) + test support

Port the framework-free user repository over the RLS client: row reads, partial
update (taken-username→DomainError via classify), and the 9-arg
upsert_user_with_accounts bootstrap. Add shared test helpers (fake db, storage,
jwt).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Default-account builder + domain context

**Files:** Create `src/domains/context.ts`, `src/domains/user/default-accounts.ts` + `.test.ts`.

- [ ] **Step 1: Define the domain context** (`src/domains/context.ts`):

```ts
import type { SdkConfig } from '../config';
import type { SdkEventMap } from '../events';
import type { SdkConnections } from '../internal/connections';
import type { SdkEventEmitter } from '../internal/event-emitter';

/** Dependencies every domain implementation receives from the `Sdk`. */
export type DomainContext = {
  config: SdkConfig;
  connections: SdkConnections;
  emitter: SdkEventEmitter<SdkEventMap>;
};
```

- [ ] **Step 2: Implement** (`src/domains/user/default-accounts.ts`):

```ts
import type { DefaultAccountConfig } from '../../config';
import { SdkError } from '../../errors';
import type { Database } from '../../internal/db/database';

type AccountInput = Database['wallet']['CompositeTypes']['account_input'];

/**
 * Normalize a mint URL: trim + strip trailing slashes; lowercase scheme + host
 * (path case preserved). Inlined from `app/lib/cashu/utils.ts`; the canonical
 * cashu utils land in S5.
 */
export function normalizeMintUrl(mintUrl: string): string {
  const trimmed = mintUrl.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

/** Map a {@link DefaultAccountConfig} to the DB `account_input` composite. */
export function toAccountInput(config: DefaultAccountConfig): AccountInput {
  if (config.type === 'cashu') {
    return {
      type: 'cashu',
      purpose: config.purpose,
      currency: config.currency,
      name: config.name,
      details: {
        mint_url: normalizeMintUrl(config.mintUrl),
        is_test_mint: config.isTestMint,
        keyset_counters: {},
      },
      is_default: config.isDefault,
    };
  }
  return {
    type: 'spark',
    purpose: config.purpose,
    currency: config.currency,
    name: config.name,
    details: { network: config.network },
    is_default: config.isDefault,
  };
}

/**
 * Build the `account_input[]` for the user-row bootstrap, validating that at
 * least one BTC Spark account is present (the RPC requires it).
 */
export function buildDefaultAccountInputs(
  defaults: DefaultAccountConfig[],
): AccountInput[] {
  const hasBtcSpark = defaults.some(
    (a) => a.type === 'spark' && a.currency === 'BTC',
  );
  if (!hasBtcSpark) {
    throw new SdkError(
      'defaultAccounts must include a BTC Spark account to bootstrap a user',
      'INVALID_DEFAULT_ACCOUNTS',
    );
  }
  return defaults.map(toAccountInput);
}

/** The Breez network for the spark identity pubkey, from the BTC Spark default. */
export function sparkNetworkForBootstrap(
  defaults: DefaultAccountConfig[],
): 'mainnet' | 'regtest' {
  const sparkBtc = defaults.find(
    (a) => a.type === 'spark' && a.currency === 'BTC',
  );
  const network =
    sparkBtc && sparkBtc.type === 'spark' ? sparkBtc.network : 'MAINNET';
  return network.toLowerCase() as 'mainnet' | 'regtest';
}
```

- [ ] **Step 3: Write the test** (`default-accounts.test.ts`):

```ts
import { describe, expect, it } from 'bun:test';
import type { DefaultAccountConfig } from '../../config';
import { SdkError } from '../../errors';
import {
  buildDefaultAccountInputs,
  normalizeMintUrl,
  sparkNetworkForBootstrap,
  toAccountInput,
} from './default-accounts';

const sparkBtc: DefaultAccountConfig = {
  type: 'spark',
  currency: 'BTC',
  name: 'Bitcoin',
  network: 'MAINNET',
  purpose: 'transactional',
  isDefault: true,
};
const cashuUsd: DefaultAccountConfig = {
  type: 'cashu',
  currency: 'USD',
  name: 'Testnut USD',
  mintUrl: 'https://testnut.cashu.space/',
  isTestMint: true,
  purpose: 'transactional',
  isDefault: true,
};

describe('default-accounts', () => {
  it('maps a spark config → spark account_input', () => {
    expect(toAccountInput(sparkBtc)).toEqual({
      type: 'spark',
      purpose: 'transactional',
      currency: 'BTC',
      name: 'Bitcoin',
      details: { network: 'MAINNET' },
      is_default: true,
    });
  });

  it('maps a cashu config → cashu account_input with normalized mint url', () => {
    expect(toAccountInput(cashuUsd)).toEqual({
      type: 'cashu',
      purpose: 'transactional',
      currency: 'USD',
      name: 'Testnut USD',
      details: {
        mint_url: 'https://testnut.cashu.space',
        is_test_mint: true,
        keyset_counters: {},
      },
      is_default: true,
    });
  });

  it('normalizeMintUrl strips trailing slash + lowercases host', () => {
    expect(normalizeMintUrl('https://Testnut.Cashu.Space/')).toBe(
      'https://testnut.cashu.space',
    );
  });

  it('buildDefaultAccountInputs requires a BTC Spark account', () => {
    expect(() => buildDefaultAccountInputs([cashuUsd])).toThrow(SdkError);
    expect(buildDefaultAccountInputs([sparkBtc, cashuUsd])).toHaveLength(2);
  });

  it('sparkNetworkForBootstrap lowercases the BTC spark network', () => {
    expect(sparkNetworkForBootstrap([sparkBtc])).toBe('mainnet');
  });
});
```

- [ ] **Step 4: Run + verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): default-account builder + DomainContext

Map DefaultAccountConfig → DB account_input (with normalizeMintUrl), validate a
BTC Spark account is present, and resolve the bootstrap spark network. Add the
shared DomainContext type.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Guest credential store (`guest-storage.ts`)

**Files:** Create `src/domains/auth/guest-storage.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/domains/auth/guest-storage.ts`):

```ts
import type { StorageProvider } from '@agicash/opensecret';

const GUEST_KEY = 'guestAccount';

/** A persisted guest's OpenSecret id + generated password. */
export type GuestCredentials = { id: string; password: string };

/**
 * Stores guest credentials in the SDK's persistent storage (framework-free;
 * browser = localStorage, MCP = its own provider). Mirrors the web's
 * `guestAccountStorage` shape under the same `guestAccount` key.
 */
export class GuestCredentialStore {
  constructor(private readonly storage: StorageProvider) {}

  async get(): Promise<GuestCredentials | null> {
    const raw = await this.storage.persistent.getItem(GUEST_KEY);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<GuestCredentials>;
      if (typeof parsed.id === 'string' && typeof parsed.password === 'string') {
        return { id: parsed.id, password: parsed.password };
      }
    } catch {
      // fall through to null on malformed JSON
    }
    return null;
  }

  async store(credentials: GuestCredentials): Promise<void> {
    await this.storage.persistent.setItem(GUEST_KEY, JSON.stringify(credentials));
  }

  async clear(): Promise<void> {
    await this.storage.persistent.removeItem(GUEST_KEY);
  }
}
```

- [ ] **Step 2: Write the test** (`guest-storage.test.ts`):

```ts
import { describe, expect, it } from 'bun:test';
import { inMemoryStorage } from '../../internal/test-support';
import { GuestCredentialStore } from './guest-storage';

describe('GuestCredentialStore', () => {
  it('round-trips stored credentials', async () => {
    const store = new GuestCredentialStore(inMemoryStorage());
    await store.store({ id: 'g1', password: 'pw' });
    expect(await store.get()).toEqual({ id: 'g1', password: 'pw' });
  });

  it('returns null when nothing is stored', async () => {
    const store = new GuestCredentialStore(inMemoryStorage());
    expect(await store.get()).toBeNull();
  });

  it('returns null for malformed JSON', async () => {
    const store = new GuestCredentialStore(
      inMemoryStorage({ guestAccount: 'not json' }),
    );
    expect(await store.get()).toBeNull();
  });

  it('clear() removes the stored credentials', async () => {
    const storage = inMemoryStorage();
    const store = new GuestCredentialStore(storage);
    await store.store({ id: 'g1', password: 'pw' });
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});
```

- [ ] **Step 3: Run + verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): guest credential store over storage provider

Persist guest {id,password} under the `guestAccount` key via the SDK storage
provider (framework-free), replacing the web's raw-localStorage store.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Session resolver + ensure-on-resolve bootstrap (`session-resolver.ts`)

**Files:** Create `src/domains/user/session-resolver.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/domains/user/session-resolver.ts`):

```ts
import { SdkError } from '../../errors';
import type { User } from '../../types/user';
import {
  deriveCashuLockingXpub,
  deriveEncryptionPublicKey,
  deriveSparkIdentityPublicKey,
} from '../../internal/crypto/bootstrap-keys';
import { fetchUser, isLoggedIn } from '../../internal/connections/open-secret';
import { UserRepository } from '../../internal/repositories/user-repository';
import type { DomainContext } from '../context';
import {
  buildDefaultAccountInputs,
  sparkNetworkForBootstrap,
} from './default-accounts';

/** Terms timestamps that ride a sign-up / OAuth into the bootstrap. */
export type ResolveSessionOptions = {
  termsAcceptedAt?: string;
  giftCardMintTermsAcceptedAt?: string;
};

type OpenSecretIdentity = {
  id: string;
  email?: string;
  email_verified: boolean;
};

/** True if the wallet user has drifted from the OpenSecret identity (email / verified). */
export function hasUserChanged(
  user: User,
  identity: OpenSecretIdentity,
): boolean {
  const identityEmail = identity.email ?? null;
  const userEmail = user.isGuest ? null : user.email;
  return (
    userEmail !== identityEmail || user.emailVerified !== identity.email_verified
  );
}

async function bootstrapUser(
  ctx: DomainContext,
  repo: UserRepository,
  identity: OpenSecretIdentity,
  options: ResolveSessionOptions,
): Promise<User> {
  const defaults = ctx.config.defaultAccounts ?? [];
  const accounts = buildDefaultAccountInputs(defaults);
  const [cashuLockingXpub, encryptionPublicKey, sparkIdentityPublicKey] =
    await Promise.all([
      deriveCashuLockingXpub(ctx.connections.keys),
      deriveEncryptionPublicKey(ctx.connections.keys),
      deriveSparkIdentityPublicKey(
        ctx.connections.keys,
        sparkNetworkForBootstrap(defaults),
      ),
    ]);
  return repo.upsert({
    id: identity.id,
    email: identity.email ?? null,
    emailVerified: identity.email_verified,
    accounts,
    cashuLockingXpub,
    encryptionPublicKey,
    sparkIdentityPublicKey,
    termsAcceptedAt: options.termsAcceptedAt,
    giftCardMintTermsAcceptedAt: options.giftCardMintTermsAcceptedAt,
  });
}

/**
 * Resolve the current wallet user (ensure-on-resolve, D2). Returns null when no
 * session is active. Reads the `wallet.users` row by the OpenSecret id; if it is
 * missing or has drifted (email / emailVerified) it derives keys + default
 * accounts and runs `upsert_user_with_accounts`.
 */
export async function resolveSession(
  ctx: DomainContext,
  options: ResolveSessionOptions = {},
): Promise<User | null> {
  if (!(await isLoggedIn(ctx.config.storage))) {
    return null;
  }
  const { user: identity } = await fetchUser();
  const repo = new UserRepository(ctx.connections.supabase);
  const existing = await repo.get(identity.id);
  if (existing && !hasUserChanged(existing, identity)) {
    return existing;
  }
  return bootstrapUser(ctx, repo, identity, options);
}

/** As {@link resolveSession}, but throws if no user resolves (post-auth invariant). */
export async function resolveSessionRequired(
  ctx: DomainContext,
  options: ResolveSessionOptions = {},
): Promise<User> {
  const user = await resolveSession(ctx, options);
  if (!user) {
    throw new SdkError(
      'Session resolution failed after authentication',
      'SESSION_RESOLUTION_FAILED',
    );
  }
  return user;
}
```

- [ ] **Step 2: Write the test** (`session-resolver.test.ts`). Mock `@agicash/opensecret` (fetchUser + the key APIs `openSecretKeyProvider` adapts) and `@agicash/breez-sdk-spark` (spark identity), and drive the resolver through a fake db:

```ts
import { describe, expect, it, mock } from 'bun:test';
import type { SdkConfig } from '../../config';

const fetchUserMock = mock(async () => ({
  user: { id: 'u1', email_verified: false },
}));

mock.module('@agicash/opensecret', () => ({
  fetchUser: fetchUserMock,
  // key provider passthroughs (used via connections.keys, but stubbed here):
  getPrivateKey: async () => ({ mnemonic: 'm' }),
  getPrivateKeyBytes: async () => ({ private_key: '00'.repeat(32) }),
  getPublicKey: async () => ({ public_key: 'enc', algorithm: 'schnorr' }),
}));
mock.module('@agicash/breez-sdk-spark', () => ({
  default: async () => {},
  defaultExternalSigner: () => ({
    identityPublicKey: () => ({ bytes: new Uint8Array([7]) }),
  }),
}));

const { resolveSession, hasUserChanged } = await import('./session-resolver');
import type { DomainContext } from '../context';
import type { KeyProvider } from '../../internal/crypto/keys';
import { inMemoryStorage, jwtWith, makeFakeDb } from '../../internal/test-support';
import { SdkEventEmitter } from '../../internal/event-emitter';

const dbRow = {
  id: 'u1',
  username: 'alice',
  email: null,
  email_verified: false,
  created_at: 't',
  updated_at: 't',
  cashu_locking_xpub: 'x',
  encryption_public_key: 'e',
  spark_identity_public_key: 's',
  default_btc_account_id: 'btc',
  default_usd_account_id: null,
  default_currency: 'BTC',
  terms_accepted_at: null,
  gift_card_mint_terms_accepted_at: null,
};

const keys: KeyProvider = {
  getChildMnemonic: async () =>
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  getPrivateKeyBytes: async () => new Uint8Array(32),
  getPublicKeyHex: async () => 'enc-pub',
};

function ctx(
  db: ReturnType<typeof makeFakeDb>,
  loggedIn = true,
): DomainContext {
  const storage = loggedIn
    ? inMemoryStorage({
        access_token: jwtWith({ sub: 'u1' }),
        refresh_token: jwtWith({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      })
    : inMemoryStorage();
  return {
    config: {
      defaultAccounts: [
        {
          type: 'spark',
          currency: 'BTC',
          name: 'Bitcoin',
          network: 'MAINNET',
          purpose: 'transactional',
          isDefault: true,
        },
      ],
      storage,
    } as unknown as SdkConfig,
    connections: {
      supabase: db,
      keys,
    } as unknown as DomainContext['connections'],
    emitter: new SdkEventEmitter(),
  };
}

describe('hasUserChanged', () => {
  it('detects email drift', () => {
    const guest = { isGuest: true, emailVerified: false } as never;
    expect(hasUserChanged(guest, { id: 'u1', email: 'a@b.co', email_verified: false })).toBe(true);
  });
  it('detects verified drift', () => {
    const full = { isGuest: false, email: 'a@b.co', emailVerified: false } as never;
    expect(hasUserChanged(full, { id: 'u1', email: 'a@b.co', email_verified: true })).toBe(true);
  });
  it('no drift → false', () => {
    const guest = { isGuest: true, emailVerified: false } as never;
    expect(hasUserChanged(guest, { id: 'u1', email_verified: false })).toBe(false);
  });
});

describe('resolveSession', () => {
  it('returns null when not logged in', async () => {
    const db = makeFakeDb({ selectResult: { data: null, error: null } });
    expect(await resolveSession(ctx(db, false))).toBeNull();
  });

  it('returns the existing row when there is no drift (no upsert)', async () => {
    const calls = { rpc: [] as Array<{ name: string; args: unknown }> };
    const db = makeFakeDb({ selectResult: { data: dbRow, error: null }, calls });
    const user = await resolveSession(ctx(db));
    expect(user?.id).toBe('u1');
    expect(calls.rpc).toHaveLength(0);
  });

  it('bootstraps (upsert) when the row is missing', async () => {
    const calls = { rpc: [] as Array<{ name: string; args: unknown }> };
    const db = makeFakeDb({
      selectResult: { data: null, error: null },
      rpcResult: { data: { user: dbRow, accounts: [] }, error: null },
      calls,
    });
    const user = await resolveSession(ctx(db), {
      termsAcceptedAt: '2026-06-16T00:00:00Z',
    });
    expect(user?.id).toBe('u1');
    expect(calls.rpc[0]?.name).toBe('upsert_user_with_accounts');
    const args = calls.rpc[0]?.args as Record<string, unknown>;
    expect(args.p_cashu_locking_xpub).toStartWith('xpub');
    expect(args.p_encryption_public_key).toBe('enc-pub');
    expect(args.p_spark_identity_public_key).toBe('07');
    expect(args.p_terms_accepted_at).toBe('2026-06-16T00:00:00Z');
    expect((args.p_accounts as unknown[]).length).toBe(1);
  });
});
```

- [ ] **Step 3: Run + verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): session resolver + ensure-on-resolve bootstrap

resolveSession reads the wallet.users row by OpenSecret id and, on
missing/drifted (email/emailVerified), derives keys + default accounts and runs
upsert_user_with_accounts (D2). Both auth sign-in tails and getCurrentUser use it.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: User domain (`user-domain.ts`)

**Files:** Create `src/domains/user/user-domain.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/domains/user/user-domain.ts`):

```ts
import { SdkError } from '../../errors';
import type { UserDomain } from '../../domains';
import type { Currency } from '../../types/money';
import type { User } from '../../types/user';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import { UserRepository } from '../../internal/repositories/user-repository';
import type { DomainContext } from '../context';
import { resolveSession } from './session-resolver';

/** Build the user domain over the shared context. */
export function createUserDomain(ctx: DomainContext): UserDomain {
  const repo = new UserRepository(ctx.connections.supabase);

  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) {
      throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    }
    return id;
  };

  const emitUpdated = (user: User): User => {
    ctx.emitter.emit('user:updated', { user });
    return user;
  };

  return {
    getCurrentUser() {
      return resolveSession(ctx);
    },
    async updateUsername(username: string) {
      const userId = await requireUserId();
      return emitUpdated(await repo.update(userId, { username }));
    },
    async acceptTerms(params: { wallet?: boolean; giftCardMint?: boolean }) {
      const userId = await requireUserId();
      const now = new Date().toISOString();
      return emitUpdated(
        await repo.update(userId, {
          termsAcceptedAt: params.wallet ? now : undefined,
          giftCardMintTermsAcceptedAt: params.giftCardMint ? now : undefined,
        }),
      );
    },
    async setDefaultCurrency(currency: Currency) {
      const userId = await requireUserId();
      return emitUpdated(await repo.update(userId, { defaultCurrency: currency }));
    },
  };
}
```

- [ ] **Step 2: Write the test** (`user-domain.test.ts`):

```ts
import { describe, expect, it, mock } from 'bun:test';
import type { SdkConfig } from '../../config';

mock.module('@agicash/opensecret', () => ({
  fetchUser: async () => ({ user: { id: 'u1', email_verified: false } }),
}));

const { createUserDomain } = await import('./user-domain');
import type { DomainContext } from '../context';
import { DomainError } from '../../errors';
import { inMemoryStorage, jwtWith, makeFakeDb } from '../../internal/test-support';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { SdkEventMap } from '../../events';

const dbRow = {
  id: 'u1',
  username: 'alice',
  email: 'a@b.co',
  email_verified: true,
  created_at: 't',
  updated_at: 't',
  cashu_locking_xpub: 'x',
  encryption_public_key: 'e',
  spark_identity_public_key: 's',
  default_btc_account_id: 'btc',
  default_usd_account_id: null,
  default_currency: 'BTC',
  terms_accepted_at: null,
  gift_card_mint_terms_accepted_at: null,
};

function ctx(db: ReturnType<typeof makeFakeDb>) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const events: Array<{ user: { id: string } }> = [];
  emitter.on('user:updated', (e) => events.push(e));
  return {
    ctx: {
      config: {
        storage: inMemoryStorage({ access_token: jwtWith({ sub: 'u1' }) }),
      } as unknown as SdkConfig,
      connections: { supabase: db } as unknown as DomainContext['connections'],
      emitter,
    } as DomainContext,
    events,
  };
}

describe('user domain', () => {
  it('updateUsername updates + emits user:updated', async () => {
    const calls = { update: [] as unknown[] };
    const { ctx: c, events } = ctx(
      makeFakeDb({ updateResult: { data: dbRow, error: null }, calls }),
    );
    const user = await createUserDomain(c).updateUsername('alice');
    expect(user.username).toBe('alice');
    expect(calls.update[0]).toEqual({ username: 'alice' });
    expect(events).toHaveLength(1);
  });

  it('updateUsername surfaces a taken username as DomainError (no event)', async () => {
    const { ctx: c, events } = ctx(
      makeFakeDb({
        updateResult: { data: null, error: { code: '23505', message: 'dup' } },
      }),
    );
    await expect(
      createUserDomain(c).updateUsername('taken'),
    ).rejects.toBeInstanceOf(DomainError);
    expect(events).toHaveLength(0);
  });

  it('acceptTerms({wallet:true}) sets only terms_accepted_at', async () => {
    const calls = { update: [] as unknown[] };
    const { ctx: c } = ctx(
      makeFakeDb({ updateResult: { data: dbRow, error: null }, calls }),
    );
    await createUserDomain(c).acceptTerms({ wallet: true });
    const payload = calls.update[0] as Record<string, unknown>;
    expect(typeof payload.terms_accepted_at).toBe('string');
    expect('gift_card_mint_terms_accepted_at' in payload).toBe(false);
  });

  it('setDefaultCurrency updates default_currency', async () => {
    const calls = { update: [] as unknown[] };
    const { ctx: c } = ctx(
      makeFakeDb({ updateResult: { data: dbRow, error: null }, calls }),
    );
    await createUserDomain(c).setDefaultCurrency('USD');
    expect(calls.update[0]).toEqual({ default_currency: 'USD' });
  });

  it('getCurrentUser resolves the existing row', async () => {
    const { ctx: c } = ctx(
      makeFakeDb({ selectResult: { data: dbRow, error: null } }),
    );
    // logged-in storage needs a refresh token for isLoggedIn:
    (c.config.storage.persistent as { setItem: (k: string, v: string) => void }).setItem(
      'refresh_token',
      jwtWith({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    );
    const user = await createUserDomain(c).getCurrentUser();
    expect(user?.id).toBe('u1');
  });
});
```

- [ ] **Step 3: Run + verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): user domain (getCurrentUser/updateUsername/acceptTerms/setDefaultCurrency)

getCurrentUser runs the resolver; mutations go through the repository and emit
user:updated. Taken username surfaces as DomainError.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Auth domain (`auth-domain.ts`)

**Files:** Create `src/domains/auth/auth-domain.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/domains/auth/auth-domain.ts`):

```ts
import type { AuthDomain } from '../../domains';
import type { User } from '../../types/user';
import { generateRandomPassword } from '../../internal/crypto/password';
import { sha256Hex } from '../../internal/crypto/sha256';
import {
  osChangePassword,
  osConfirmPasswordReset,
  osConvertGuestToUserAccount,
  osHandleGoogleCallback,
  osInitiateGoogleAuth,
  osRefreshAccessToken,
  osRequestNewVerificationCode,
  osRequestPasswordReset,
  osSignIn,
  osSignInGuest,
  osSignOut,
  osSignUp,
  osSignUpGuest,
  osVerifyEmail,
} from '../../internal/connections/open-secret';
import type { DomainContext } from '../context';
import {
  resolveSessionRequired,
  type ResolveSessionOptions,
} from '../user/session-resolver';
import { GuestCredentialStore } from './guest-storage';

/** Build the auth domain over the shared context. */
export function createAuthDomain(ctx: DomainContext): AuthDomain {
  const guest = new GuestCredentialStore(ctx.config.storage);

  const signedIn = async (options?: ResolveSessionOptions): Promise<User> => {
    const user = await resolveSessionRequired(ctx, options);
    ctx.emitter.emit('auth:signed-in', { user });
    return user;
  };

  return {
    async signIn({ email, password }) {
      await osSignIn(email, password);
      return signedIn();
    },
    async signUp({ email, password, termsAcceptedAt, giftCardMintTermsAcceptedAt }) {
      await osSignUp(email, password, '');
      return signedIn({ termsAcceptedAt, giftCardMintTermsAcceptedAt });
    },
    async signInGuest(params = {}) {
      const existing = await guest.get();
      if (existing) {
        await osSignInGuest(existing.id, existing.password);
      } else {
        const password = generateRandomPassword(32);
        const { id } = await osSignUpGuest(password, '');
        await guest.store({ id, password });
      }
      return signedIn(params);
    },
    async signOut() {
      await osSignOut();
      ctx.emitter.emit('auth:signed-out', {});
    },
    async refresh() {
      await osRefreshAccessToken();
    },
    async resetPassword(email) {
      const secret = generateRandomPassword(20);
      const hashedSecret = await sha256Hex(secret);
      await osRequestPasswordReset(email, hashedSecret);
      return { secret };
    },
    async confirmPasswordReset({ email, code, secret, newPassword }) {
      await osConfirmPasswordReset(email, code, secret, newPassword);
    },
    async changePassword({ current, new: newPassword }) {
      await osChangePassword(current, newPassword);
    },
    async upgradeGuest({ email, password }) {
      await osConvertGuestToUserAccount(email, password);
      await guest.clear();
      return signedIn();
    },
    async beginGoogleSignIn() {
      const { auth_url } = await osInitiateGoogleAuth('');
      return { authUrl: auth_url };
    },
    async completeOAuth({ code, state, termsAcceptedAt, giftCardMintTermsAcceptedAt }) {
      await osHandleGoogleCallback(code, state, '');
      return signedIn({ termsAcceptedAt, giftCardMintTermsAcceptedAt });
    },
    async verifyEmail(code) {
      await osVerifyEmail(code);
      const user = await resolveSessionRequired(ctx);
      ctx.emitter.emit('user:updated', { user });
      return user;
    },
    async requestEmailVerificationCode() {
      await osRequestNewVerificationCode();
    },
  };
}
```

- [ ] **Step 2: Write the test** (`auth-domain.test.ts`). Mock OpenSecret (auth fns + fetchUser) + breez (bootstrap path), and pre-seed storage tokens so post-auth `isLoggedIn` passes:

```ts
import { describe, expect, it, mock } from 'bun:test';
import type { SdkConfig } from '../../config';

const calls = {
  signIn: [] as unknown[],
  signUp: [] as unknown[],
  signUpGuest: [] as unknown[],
  signInGuest: [] as unknown[],
  signOut: 0,
  resetPassword: [] as unknown[],
  verifyEmail: [] as unknown[],
  initiateGoogle: 0,
};

mock.module('@agicash/opensecret', () => ({
  signIn: async (...a: unknown[]) => {
    calls.signIn.push(a);
    return { id: 'u1', access_token: 'a', refresh_token: 'r' };
  },
  signUp: async (...a: unknown[]) => {
    calls.signUp.push(a);
    return { id: 'u1', access_token: 'a', refresh_token: 'r' };
  },
  signUpGuest: async (...a: unknown[]) => {
    calls.signUpGuest.push(a);
    return { id: 'guest-1', access_token: 'a', refresh_token: 'r' };
  },
  signInGuest: async (...a: unknown[]) => {
    calls.signInGuest.push(a);
    return { id: 'guest-1', access_token: 'a', refresh_token: 'r' };
  },
  signOut: async () => {
    calls.signOut += 1;
  },
  requestPasswordReset: async (...a: unknown[]) => {
    calls.resetPassword.push(a);
  },
  verifyEmail: async (...a: unknown[]) => {
    calls.verifyEmail.push(a);
  },
  initiateGoogleAuth: async () => {
    calls.initiateGoogle += 1;
    return { auth_url: 'https://accounts.google/x', csrf_token: 'c' };
  },
  requestNewVerificationCode: async () => {},
  confirmPasswordReset: async () => {},
  changePassword: async () => {},
  refreshAccessToken: async () => ({ access_token: 'a2', refresh_token: 'r2' }),
  convertGuestToUserAccount: async () => {},
  handleGoogleCallback: async () => ({ id: 'u1', access_token: 'a', refresh_token: 'r' }),
  fetchUser: async () => ({ user: { id: 'u1', email_verified: false } }),
  getPrivateKey: async () => ({ mnemonic: 'm' }),
  getPrivateKeyBytes: async () => ({ private_key: '00'.repeat(32) }),
  getPublicKey: async () => ({ public_key: 'enc', algorithm: 'schnorr' }),
}));
mock.module('@agicash/breez-sdk-spark', () => ({
  default: async () => {},
  defaultExternalSigner: () => ({
    identityPublicKey: () => ({ bytes: new Uint8Array([7]) }),
  }),
}));

const { createAuthDomain } = await import('./auth-domain');
import type { DomainContext } from '../context';
import type { KeyProvider } from '../../internal/crypto/keys';
import { inMemoryStorage, jwtWith, makeFakeDb } from '../../internal/test-support';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { SdkEventMap } from '../../events';

const dbRow = {
  id: 'u1', username: 'alice', email: null, email_verified: false,
  created_at: 't', updated_at: 't', cashu_locking_xpub: 'x',
  encryption_public_key: 'e', spark_identity_public_key: 's',
  default_btc_account_id: 'btc', default_usd_account_id: null,
  default_currency: 'BTC', terms_accepted_at: null,
  gift_card_mint_terms_accepted_at: null,
};

const keys: KeyProvider = {
  getChildMnemonic: async () =>
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  getPrivateKeyBytes: async () => new Uint8Array(32),
  getPublicKeyHex: async () => 'enc-pub',
};

function setup(db: ReturnType<typeof makeFakeDb>) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const signedIn: Array<{ user: { id: string } }> = [];
  const signedOut: unknown[] = [];
  const updated: unknown[] = [];
  emitter.on('auth:signed-in', (e) => signedIn.push(e));
  emitter.on('auth:signed-out', (e) => signedOut.push(e));
  emitter.on('user:updated', (e) => updated.push(e));
  const storage = inMemoryStorage({
    access_token: jwtWith({ sub: 'u1' }),
    refresh_token: jwtWith({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  });
  const ctx: DomainContext = {
    config: {
      defaultAccounts: [
        { type: 'spark', currency: 'BTC', name: 'Bitcoin', network: 'MAINNET', purpose: 'transactional', isDefault: true },
      ],
      storage,
    } as unknown as SdkConfig,
    connections: { supabase: db, keys } as unknown as DomainContext['connections'],
    emitter,
  };
  return { ctx, signedIn, signedOut, updated, storage };
}

describe('auth domain', () => {
  it('signIn → resolves existing user + emits auth:signed-in', async () => {
    const { ctx, signedIn } = setup(
      makeFakeDb({ selectResult: { data: dbRow, error: null } }),
    );
    const user = await createAuthDomain(ctx).signIn({ email: 'a@b.co', password: 'pw' });
    expect(user.id).toBe('u1');
    expect(calls.signIn[0]).toEqual(['a@b.co', 'pw']);
    expect(signedIn).toHaveLength(1);
  });

  it('signUp → bootstraps (upsert) + emits auth:signed-in', async () => {
    const { ctx, signedIn } = setup(
      makeFakeDb({
        selectResult: { data: null, error: null },
        rpcResult: { data: { user: dbRow, accounts: [] }, error: null },
      }),
    );
    await createAuthDomain(ctx).signUp({ email: 'a@b.co', password: 'pw' });
    expect(calls.signUp[0]).toEqual(['a@b.co', 'pw', '']);
    expect(signedIn).toHaveLength(1);
  });

  it('signInGuest with no stored creds → signs up + stores creds', async () => {
    const { ctx, storage } = setup(
      makeFakeDb({
        selectResult: { data: null, error: null },
        rpcResult: { data: { user: dbRow, accounts: [] }, error: null },
      }),
    );
    await createAuthDomain(ctx).signInGuest();
    expect(calls.signUpGuest).toHaveLength(1);
    expect(await storage.persistent.getItem('guestAccount')).toContain('guest-1');
  });

  it('signInGuest with stored creds → signs in with them', async () => {
    const { ctx } = setup(
      makeFakeDb({ selectResult: { data: dbRow, error: null } }),
    );
    await ctx.config.storage.persistent.setItem(
      'guestAccount',
      JSON.stringify({ id: 'guest-1', password: 'pw' }),
    );
    await createAuthDomain(ctx).signInGuest();
    expect(calls.signInGuest[0]).toEqual(['guest-1', 'pw']);
  });

  it('signOut emits auth:signed-out', async () => {
    const { ctx, signedOut } = setup(makeFakeDb({}));
    await createAuthDomain(ctx).signOut();
    expect(signedOut).toHaveLength(1);
  });

  it('resetPassword hashes the secret and returns it', async () => {
    const { ctx } = setup(makeFakeDb({}));
    const { secret } = await createAuthDomain(ctx).resetPassword('a@b.co');
    expect(typeof secret).toBe('string');
    const [email, hash] = calls.resetPassword.at(-1) as [string, string];
    expect(email).toBe('a@b.co');
    expect(hash).not.toBe(secret); // sent the hash, not the plaintext
  });

  it('verifyEmail re-resolves + emits user:updated', async () => {
    const { ctx, updated } = setup(
      makeFakeDb({ selectResult: { data: dbRow, error: null } }),
    );
    const user = await createAuthDomain(ctx).verifyEmail('123456');
    expect(user.id).toBe('u1');
    expect(calls.verifyEmail.at(-1)).toEqual(['123456']);
    expect(updated).toHaveLength(1);
  });

  it('beginGoogleSignIn returns the auth url', async () => {
    const { ctx } = setup(makeFakeDb({}));
    const { authUrl } = await createAuthDomain(ctx).beginGoogleSignIn();
    expect(authUrl).toBe('https://accounts.google/x');
  });
});
```

- [ ] **Step 3: Run + verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): auth domain (sign in/up/guest/out, reset, verify, OAuth, refresh)

OpenSecret-wrapped auth operations; sign-in tails run the resolver and emit
auth:signed-in; verifyEmail re-resolves and emits user:updated; guest creds via
the storage-backed store.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Wire `auth` + `user` into `Sdk`

**Files:** Modify `src/sdk.ts`, `src/sdk.test.ts`.

- [ ] **Step 1: Rewire `sdk.ts`.** Replace the `auth`/`user` stub field initializers and the emitter/events field initializers with constructor-body assignment (robust against field-init ordering — uses the constructor params + a locally built emitter). Update imports and the class body:

```ts
import type { SdkConfig } from './config';
import type {
  AccountsDomain,
  AuthDomain,
  BackgroundDomain,
  CashuDomain,
  CashuReceiveOps,
  CashuSendOps,
  ContactsDomain,
  ExchangeRateDomain,
  ScanDomain,
  SparkDomain,
  SparkReceiveOps,
  SparkSendOps,
  TransactionsDomain,
  TransfersDomain,
  UserDomain,
} from './domains';
import type { EventEmitter, SdkEventMap } from './events';
import { createAuthDomain } from './domains/auth/auth-domain';
import { createUserDomain } from './domains/user/user-domain';
import type { DomainContext } from './domains/context';
import { buildConnections, type SdkConnections } from './internal/connections';
import { SdkEventEmitter } from './internal/event-emitter';
import { notImplementedDomain } from './internal/not-implemented';

export class Sdk {
  readonly auth: AuthDomain;
  readonly user: UserDomain;
  readonly accounts: AccountsDomain =
    notImplementedDomain<AccountsDomain>('accounts');
  readonly cashu: CashuDomain = {
    send: notImplementedDomain<CashuSendOps>('cashu.send'),
    receive: notImplementedDomain<CashuReceiveOps>('cashu.receive'),
  };
  readonly spark: SparkDomain = {
    send: notImplementedDomain<SparkSendOps>('spark.send'),
    receive: notImplementedDomain<SparkReceiveOps>('spark.receive'),
  };
  readonly transactions: TransactionsDomain =
    notImplementedDomain<TransactionsDomain>('transactions');
  readonly contacts: ContactsDomain =
    notImplementedDomain<ContactsDomain>('contacts');
  readonly transfers: TransfersDomain =
    notImplementedDomain<TransfersDomain>('transfers');
  readonly scan: ScanDomain = notImplementedDomain<ScanDomain>('scan');
  readonly exchangeRate: ExchangeRateDomain =
    notImplementedDomain<ExchangeRateDomain>('exchangeRate');
  readonly background: BackgroundDomain =
    notImplementedDomain<BackgroundDomain>('background');

  private readonly emitter: SdkEventEmitter<SdkEventMap>;
  readonly events: EventEmitter<SdkEventMap>;

  protected constructor(
    protected readonly config: SdkConfig,
    protected readonly connections: SdkConnections,
  ) {
    this.emitter = new SdkEventEmitter<SdkEventMap>();
    this.events = this.emitter;
    const ctx: DomainContext = { config, connections, emitter: this.emitter };
    this.user = createUserDomain(ctx);
    this.auth = createAuthDomain(ctx);
  }

  /** Construct the SDK from `config`, wiring the full connection bundle. */
  static async create(config: SdkConfig): Promise<Sdk> {
    const connections = buildConnections(config);
    return new Sdk(config, connections);
  }

  /** Tear down realtime channels and clear event handlers. */
  async destroy(): Promise<void> {
    await this.connections.supabase.removeAllChannels();
    this.emitter.removeAll();
  }
}
```

(Keep the class JSDoc; update its "11 domains are stubbed" line to note auth + user are now real.)

- [ ] **Step 2: Update `sdk.test.ts`.** Add `defaultAccounts` to the config fixture and assert auth/user are real (no longer throw). Replace the existing `config` object and the "every stubbed domain" test:

```ts
const config = {
  openSecret: { url: 'https://os.test', clientId: 'c' },
  supabase: { url: 'https://sb.test', anonKey: 'anon' },
  storage: { persistent: makeMem(), session: makeMem() },
  defaultAccounts: [
    {
      type: 'spark',
      currency: 'BTC',
      name: 'Bitcoin',
      network: 'MAINNET',
      purpose: 'transactional',
      isDefault: true,
    },
  ],
} as unknown as SdkConfig;
```

Update the stub assertions (auth/user are now real; the remaining 9 still throw):

```ts
  it('auth and user domains are wired (not NotImplemented)', async () => {
    const sdk = await Sdk.create(config);
    expect(typeof sdk.auth.signIn).toBe('function');
    expect(typeof sdk.user.getCurrentUser).toBe('function');
    await sdk.destroy();
  });
  it('unimplemented domains still throw NotImplementedError', async () => {
    const sdk = await Sdk.create(config);
    expect(() => sdk.accounts.list()).toThrow(NotImplementedError);
    expect(() => sdk.cashu.send.failQuote({} as never, 'x')).toThrow(NotImplementedError);
    expect(() => sdk.background.state()).toThrow(NotImplementedError);
    await sdk.destroy();
  });
```

If the existing test reaches the internal emitter via `@ts-expect-error sdk.emitter`, keep that case (the emitter is still a private field).

- [ ] **Step 3: Run the FULL gate.** `bun run typecheck` → PASS (all 4 packages; the web is untouched and still does not import the SDK). `bun run test` → PASS (all SDK unit tests incl. the new ones).

- [ ] **Step 4: Commit.**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): wire real auth + user domains into Sdk

Build the auth + user domains from a shared DomainContext in the constructor
(emitter/events/auth/user assigned in-body for init-order safety); the other 9
domains stay stubbed. sdk.test fixture gains defaultAccounts.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verification Gate (slice done when)

- `bun run typecheck` green (4 packages) and `bun run test` green (all new SDK unit tests).
- **Named S3 regression (spec §10):** taken-username → `DomainError` — covered in `user-repository.test.ts` and `user-domain.test.ts`. (The stale-balance `synced` re-read, nutshell-#788 change refetch, and transfer auto-fail regressions belong to S6/S7/S8 — explicitly not this slice.)
- The web still typechecks (it does not import the SDK yet; the dark build is untouched).
- Spot-check the resolver flows by reading the test assertions: not-logged-in → null; existing-no-drift → no upsert; missing/drift → upsert with all 9 args incl. derived keys + `account_input[]`.

---

## Self-Review

**1. Spec coverage (§6 deltas + §7b auth/user + D2/D3):**
- AuthDomain deltas (verifyEmail, requestEmailVerificationCode, resetPassword→`{secret}`, confirmPasswordReset, terms params on signUp/signInGuest/completeOAuth) ✔ (T1 contract, T11 impl).
- UserDomain deltas (acceptTerms, setDefaultCurrency) ✔ (T1, T10).
- `user:updated` event ✔ (T1, emitted in T10/T11).
- OS-wrappers + guest-storage + pwd/sha256 → domains/auth ✔ (T2 re-exports, T8 guest, T11 uses crypto/password+sha256 from Plan 02).
- user repo (get/update/upsert + ensure-on-resolve) + UserService + dbUser mapper ✔ (T5 mapper, T6 repo, T9 resolver, T10 domain).
- ensure-on-resolve bootstrap (derive keys + upsert_user_with_accounts) ✔ (T3 spark id, T4 keys, T7 account inputs, T9 resolver) — D2.
- SDK owns key derivation incl. spark identity via Breez WASM ✔ (T3) — D3.
- defaultAccounts config (resolved fork) ✔ (T1, T7, T9).
- session-expiry timer deferred to S9 (resolved fork) — `refresh()` shipped (T11), timer explicitly out of scope.

**2. Placeholder scan:** every code step has complete code; the cashu xpub test asserts determinism + `xpub` prefix (runnable, no magic constant); `normalizeMintUrl` inlined with a named source + dedup note; the breez/opensecret test mocks are concrete factories. No TODO/TBD/"add error handling" placeholders.

**3. Type consistency:** `DomainContext` (T7) consumed by resolver/user/auth/sdk (T9–T12); `UserRepository`/`UpdateUser`/`UpsertUserParams` (T6) used by resolver (T9) + user domain (T10); `resolveSession`/`resolveSessionRequired`/`hasUserChanged` (T9) used by user (T10) + auth (T11); `toUser` (T5) used by repo (T6); `toAccountInput`/`buildDefaultAccountInputs`/`sparkNetworkForBootstrap` (T7) used by resolver (T9); `getSparkIdentityPublicKey` (T3) used by bootstrap-keys (T4); `os*` re-exports + `getCurrentUserId` (T2) used by auth (T11) + user (T10) + resolver (T9); `GuestCredentialStore` (T8) used by auth (T11). `DefaultAccountConfig` (T1) used by config + T7. The `Sdk` constructor (T12) builds both domains from `connections`/`config`/`emitter`. Method names match the amended `AuthDomain`/`UserDomain` (T1) exactly.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-03-auth-user.md`. **Subagent-Driven (recommended)** — fresh subagent per task + two-stage review. Task order is dependency-forced: T1 (contract/config) → T2 (open-secret) → T3 (breez id) → T4 (bootstrap-keys) → T5 (mapper) → T6 (repo + test-support) → T7 (default-accounts + context) → T8 (guest-storage) → T9 (resolver) → T10 (user domain) → T11 (auth domain) → T12 (wire Sdk). Tasks T2–T8 are independent leaves after T1; T9–T12 integrate them. (Alternative: inline execution via executing-plans.)
