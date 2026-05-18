# iOS Default Account — Swipe-to-Set + Per-Currency Tracking

**Status:** draft
**Date:** 2026-05-17
**Worktree:** `.claude/worktrees/ios-default-account-swipe`
**Branch:** `feat/ios-default-account-swipe`

## Problem

iOS users cannot change which account is their default. The web app tracks
defaults per currency (`defaultBtcAccountId`, `defaultUsdAccountId` on the
user row, with a `defaultCurrency` selector) and exposes a "Make default"
action on the per-account settings page. iOS currently has:

- `AccountsView.swift` rendering a card per account, no swipe gestures
- `AccountRow.swift` with a TODO comment noting badges would render if the
  signal were available; today the row never shows the default badge
- `WalletViewModel.swift` exposing `accounts: [AccountFfi]` only; no user
  data, no mutation surface
- An FFI (`AgicashWallet`) that exposes `list_accounts` + auth, but no
  `get_user`, no `set_default_account`, no `UserFfi` record
- A Rust `UserStorage` trait with `upsert_user_with_accounts` + `get_user`,
  but no targeted "update only the default fields" path

This spec adds swipe-left → "Set as default" on the iOS account list and the
backing per-currency default tracking, mirroring how the web app does it.

## Web reference (source of truth)

The web's data model and mutation path:

- `app/features/accounts/account-hooks.ts` — `useDefaultAccount` picks the
  account whose id matches `user.defaultBtcAccountId` (if
  `defaultCurrency === 'BTC'`) or `user.defaultUsdAccountId`
- `app/features/accounts/account-service.ts` — `isDefaultAccount(user,
  account)` returns true when `account.id === user.default<Currency>AccountId`
  and `account.currency` matches. `getExtendedAccounts` sorts default
  first.
- `app/features/user/user-service.ts` — `UserService.setDefaultAccount(user,
  account, { setDefaultCurrency? })` writes the matching slot on the user
  row, optionally also flipping `defaultCurrency` to the account's currency
- `app/features/user/user-repository.ts` — `WriteUserRepository.update`
  hits Supabase `users` table directly via PATCH (`db.from('users').update({
  default_btc_account_id, default_usd_account_id, default_currency, ...
  }).eq('id', userId)`)
- `app/features/settings/accounts/all-accounts.tsx` — list visual:
  card-per-row, name + balance, `<Badge>Default</Badge>` + `<Badge>Offline</Badge>`
  underneath when applicable
- `app/features/settings/accounts/single-account.tsx` — primary "Make
  default" button on per-account detail; we adapt to swipe on iOS

## iOS UX

| What | How |
|---|---|
| Default indicator | `<Badge>Default</Badge>` analogue on the account row, matching web's treatment under the title row |
| Trigger | Swipe-left on a non-default row → revealed "Set as default" action |
| Action button color | Brand primary (matches web's primary `<Button>` styling) |
| Already-default row | Shows the badge; swipe action is hidden (no-op) so the user can't redundantly re-set it |
| Result feedback | Row reorders so the default is first (mirrors web's `getExtendedAccounts.sort`); badge moves |
| Persistence | Survives app kill + relaunch (default is server-side on the user row) |
| Empty / single account | No swipe affordance needed on empty state. If only one account exists it's implicitly default — badge shows, no swipe target |

### Visual treatment

Web's row treatment (from `all-accounts.tsx`):

```tsx
<Card className="flex flex-col p-2 px-4 hover:bg-muted/50">
  <div className="flex items-center justify-between">
    <h3>{account.name}</h3>
    <MoneyWithConvertedAmount money={balance} variant="inline" />
  </div>
  {(isDefault || !isOnline) && (
    <div className="mt-1 flex gap-2">
      {isDefault && <Badge>Default</Badge>}
      {!isOnline && <Badge>Offline</Badge>}
    </div>
  )}
</Card>
```

iOS mirrors this exactly: name + balance line, then a row of small badges
when applicable. Badge uses `Color.brandPrimary` background, `Color.brandPrimaryForeground` text, `Radius.small`, `BrandFont.caption`.

### Swipe mechanics

SwiftUI's `swipeActions` only works inside `List`. We switch the rows
container from `ScrollView { VStack }` to `List`, then suppress List's
default chrome so the brand card look survives:

- `.listStyle(.plain)`
- `.scrollContentBackground(.hidden)` so the brand background bleeds through
- Per row: `.listRowBackground(Color.clear)`, `.listRowSeparator(.hidden)`,
  `.listRowInsets(...)` matching today's spacing
- `.swipeActions(edge: .trailing, allowsFullSwipe: false) { Button("Set as
  default") }` per row, gated to non-default rows only

Pull-to-refresh continues to work (`.refreshable`).

## Data model

### Rust storage (`agicash-traits`, `agicash-storage-supabase`)

Add to `UserStorage` trait:

```rust
async fn update_user_defaults(
    &self,
    user_id: UserId,
    default_btc_account_id: Option<AccountId>,
    default_usd_account_id: Option<AccountId>,
    default_currency: Option<Currency>,
) -> Result<User, StorageError>;
```

- `None` slots mean "leave unchanged"; `Some(uuid)` writes that slot
- Server returns the updated user row
- Supabase impl: postgrest PATCH on `wallet.users` filtered by `id = user_id`,
  with a body that only sets the keys whose values are `Some`. Returns the
  selected `*` row.

Mirrors the web's `WriteUserRepository.update` shape; same row, same
columns, same RLS surface.

### FFI (`agicash-ffi`)

New record:

```rust
#[derive(Debug, Clone, uniffi::Record)]
pub struct UserFfi {
    pub id: String,
    pub default_btc_account_id: Option<String>,
    pub default_usd_account_id: Option<String>,
    pub default_currency: String, // "BTC" | "USD" | "USDB"
}
```

Two new `AgicashWallet` methods:

```rust
pub async fn get_user(&self) -> Result<UserFfi, FfiError>;

pub async fn set_default_account(
    &self,
    account_id: String,
    set_default_currency: bool,
) -> Result<UserFfi, FfiError>;
```

`get_user`:
- Requires session; returns `FfiError::Auth { UNAUTHENTICATED }` otherwise
- Calls `storage.get_user(session.user_id)`
- Returns `FfiError::Internal("user row not found")` if `Ok(None)` (a
  signed-in user with no `wallet.users` row is a bug — guests have a row
  after first `upsert`)

`set_default_account`:
- Requires session
- Parses `account_id` as UUID → `FfiError::Internal("invalid account_id")`
- Calls `storage.list_accounts(user_id)`, finds the matching account; if
  missing → `FfiError::Internal("account not found")`
- Validates currency is one of `Btc | Usd` → `FfiError::Internal("unsupported currency for default")`
- Loads current user (`storage.get_user`) so we can preserve the other
  currency's default slot
- Builds the patch:
  - `default_btc_account_id` = `Some(account.id)` if account is BTC,
    else `Some(user.default_btc_account_id)` (write-back preserves)
  - `default_usd_account_id` = symmetric
  - `default_currency` = `Some(account.currency)` if `set_default_currency`,
    else `None` (leave unchanged)
- Calls `storage.update_user_defaults(...)`
- Returns the resulting user as `UserFfi`

Mirrors `UserService.setDefaultAccount` semantics exactly.

### iOS (`WalletViewModel` + `AccountRow` + `AccountsView`)

`WalletViewModel`:

- Adds `var user: UserFfi?` — fetched alongside accounts
- `refreshAccounts()` also calls `wallet.getUser()` and updates `user`.
  Failure to load the user is non-fatal (we log and leave `user` nil — UI
  falls back to "no badge shown anywhere")
- `setDefaultAccount(_ account: AccountFfi) async -> SetDefaultOutcome`
  where outcome is `success` or `failure(String)`. Calls
  `wallet.setDefaultAccount(accountId: account.id, setDefaultCurrency: false)`
  (matches web's default options — don't surprise-flip the user's
  default currency just because they set a default account in the other
  currency; web's only callers that set `setDefaultCurrency: true` are
  account-creation paths, not the swipe action)
- Exposes `isDefault(_ account: AccountFfi) -> Bool` derived from `user` + account currency
- Exposes `sortedAccounts: [AccountFfi]` returning `accounts` with the
  user's default-for-its-currency rows pulled to the top (mirrors web's
  `getExtendedAccounts.sort`)

`AccountRow`:
- New `isDefault: Bool` parameter (default false)
- Renders the "Default" badge below the name+balance line when true
- Visual: same `brandCard()`, `BrandFont.caption`, brand primary fill

`AccountsView`:
- Replaces `ScrollView { VStack }` with `List` for the populated state
- Empty state stays the same (no rows, no swipe needed)
- Each row wrapped with `.swipeActions` providing the "Set as default"
  button when `!isDefault`
- Toast / alert on failure (existing pattern: nothing — there's no toast
  system on iOS yet; failures surface as a transient SwiftUI alert)
- Refresh on success: `await model.refreshAccounts()` (which also
  refreshes user)

## Testing

### Rust FFI unit tests

Mirroring the existing `tests` mod in `wallet.rs`:

1. `get_user_without_session_returns_unauthenticated`
2. `set_default_account_without_session_returns_unauthenticated`
3. `set_default_account_rejects_bad_uuid`

Plus, in `account.rs` (new):
4. `user_ffi_from_user_serializes_optional_accounts_as_strings`
5. `user_ffi_from_user_handles_none_defaults` — when both default slots are
   nil, FFI returns `None` for both

The "happy path with real Supabase" is verified manually in sim, not in
unit tests (the existing tests don't mock the network either — they
exercise the input-validation paths only).

### Manual sim verification

1. `xcrun simctl erase all` (avoid stale-session trap)
2. Build xcframework: `bash bindings/swift/generate-bindings.sh`
3. Build + install the iOS app on the booted sim
4. Sign in as guest
5. Add two mints (so there are 2 BTC Cashu accounts + the Spark stub)
6. Initial state: one row should already carry "Default" (the Spark stub,
   because `mint_add` for a fresh user marks it `is_default: true`)
7. Swipe-left on one of the Cashu rows → tap "Set as default"
8. Expected: row reorders (new default first), badge moves to it, the
   Spark row no longer has the badge
9. Kill the app, relaunch, sign back in (or rehydrate via Keychain)
10. Expected: default still on the row we picked

## Non-goals

- USD account UX (we have no USD account creation today; the code paths
  handle USD but it's not in the sim test)
- `setDefaultCurrency: true` flow (web couples it to account-creation;
  iOS doesn't have a "currency switcher" UI yet)
- Realtime sync (web has Supabase realtime; iOS doesn't — refresh only)
- iOS unit-test target (none exists in `project.yml` today; adding one
  is bigger than the scope of this change)

## Open questions

None.
