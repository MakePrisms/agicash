---
name: playwright-agicash-navigation
description: Navigate the Agicash Bitcoin wallet app efficiently using Playwright. Use when testing, automating, or navigating the Agicash web application, especially for authentication flows, wallet operations (send/receive), account management, and transaction history. Critical for handling OAuth redirects, Terms of Service modals, and understanding the app's route structure.
---

# Playwright Agicash Navigation

Navigate the Agicash Bitcoin wallet app efficiently with Playwright, understanding its authentication flow, protected routes, and common interaction patterns.

## Development Server

Assume the app is already running and try the default server first:
- **Default URL**: `https://localhost:3000`

If the default URL is unavailable, tell the user to start the server and ask where it is running (URL and protocol). Provide the default start command as a suggestion:
- **Start command**: `bun run dev --https`

## Authentication Flow (CRITICAL)

### Unauthenticated Access

When not logged in, the app redirects to `/home` which shows a "Coming Soon" page with minimal content. This is NOT the main app.

**To access the actual wallet app, you MUST authenticate first.**

### Creating an Account

**Always navigate directly to `/signup`** when you need to create an account. Do not try to access protected routes first.

```
Navigate to: https://localhost:3000/signup
```

The signup page offers three options:
1. **Email** - "Create wallet with Email"
2. **Google** - "Create wallet with Google"
3. **Guest** - "Create wallet as Guest" (RECOMMENDED for testing)

### Guest Account Creation (Recommended)

For automated testing, use guest accounts:

1. Navigate to `https://localhost:3000/signup`
2. Click "Create wallet as Guest" button
3. **Accept Terms of Service modal**:
   - Check the ToS checkbox
   - Click "Continue" button
4. **Wait for authentication** (5 seconds recommended):
   - The app performs cryptographic operations (attestation verification, key generation)
   - Console shows logs about certificates and signature verification
   - Redirects to `/` (main dashboard) when complete

**Important**: The Continue button becomes enabled only after checking the ToS checkbox. The button will show a loading spinner during authentication.

### Post-Authentication

After successful authentication, the app redirects to the main wallet dashboard at `/`.

## Main Routes

### Dashboard (`/`)

The main wallet screen showing:
- **Balance display**: Shows BTC and USD balance (initially ₿0 / $0.00)
- **Currency selector**: "BTC" button with dropdown icon
- **Primary actions**:
  - "Receive" button → `/receive`
  - "Send" button → `/send`
- **Top navigation**:
  - Transactions icon → `/transactions`
  - Settings icon → `/settings`

### Receive (`/receive`)

Receive bitcoin screen with:
- **Amount input**: Editable balance display with USD toggle button
- **Account selector**: Shows current account (e.g., "Spark Icon Bitcoin ₿0 (~$0.00)")
- **Action buttons**:
  - Paste button (clipboard icon)
  - Scan QR code link → `/receive/scan`
- **Continue button**: Disabled until valid input provided
- **Back button**: Returns to `/`

### Send (`/send`)

Send bitcoin screen with similar structure to Receive:
- **Amount input**: Editable balance display with USD toggle button
- **Account selector**: Shows current account
- **Action buttons**:
  - Paste button (clipboard icon)
  - Scan QR code link → `/send/scan`
  - Additional action button
- **Continue button**: Disabled until valid input provided
- **Back button**: Returns to `/`

### Transactions (`/transactions`)

Transaction history page:
- **Header**: "Transactions" title with back button → `/`
- **Content**: Shows "No transactions found" for new accounts
- Eventually displays transaction list with details

### Settings (`/settings`)

Main settings page with:
- **User identifier**: Shows username (e.g., "user-cfc15ee8aed5@localhost:3000") with dropdown
- **Edit profile**: Link to `/settings/profile/edit`
- **Account selector**: Shows active account (e.g., "Spark Icon Bitcoin") → `/settings/accounts`
- **Contacts**: Link to `/settings/contacts`
- **Footer**:
  - "Sign Out" button
  - Theme toggle (system/dark/light)
  - Links: Terms, Privacy
  - Social links: X, Nostr, GitHub, Discord
- **Back button**: Returns to `/`

### Accounts (`/settings/accounts`)

Account management page with:
- **Header**: "Accounts" title with back button → `/settings`
- **Tabs**: "Bitcoin" and "USD" currency tabs
- **Account list**: Shows all accounts for selected currency
  - Each account shows name, balance, and "Default" badge if applicable
  - Accounts are clickable → `/settings/accounts/{account-id}`
  - Example accounts: "Bitcoin ₿0 (~$0.00) Default", "Testnut BTC ₿0 (~$0.00)"
- **Add Account button**: Floating action → `/settings/accounts/create/cashu`

## Common Navigation Patterns

### Back Navigation

Most pages have a back button in the top-left corner of the banner:
- Usually an arrow icon that links to the parent route
- From `/transactions`, `/send`, `/receive` → back to `/`
- From `/settings/accounts` → back to `/settings`
- From sub-settings pages → back to `/settings`

### Link vs Button Navigation

The app uses both links and buttons for navigation:
- **Links** (`<a>` tags with `/url:`): Use `browser_click` on the link
- **Buttons** that navigate: Use `browser_click` on the button, which triggers programmatic navigation

### Loading States

After clicking buttons that trigger navigation or actions:
- Buttons may show loading spinners (disabled state with spinner icon)
- Wait 2-5 seconds for operations to complete
- Use `browser_wait_for` with time parameter for cryptographic operations
- Check for URL changes or new page content to confirm navigation

### Modal Dialogs

The app uses modal dialogs for:
- **Terms of Service**: Appears during signup, requires checkbox + Continue
- **Account selection**: Dropdown modals for choosing accounts
- **Amount input**: USD/BTC toggle modals

When a modal appears, interact with its elements before attempting to navigate away.

### Amount Input on Send/Receive

On `/send` and `/receive` routes, there is **no visible input field** for the amount. The page captures keyboard input directly:

1. Navigate to `/send` or `/receive`
2. Use `browser_press_key` to type digits (e.g., `1`, `0`, `0` for 100 sats)
3. The display updates in real-time (e.g., `₿0` → `₿1` → `₿10` → `₿100`)
4. The Continue button enables once a valid amount is entered

```javascript
// Example: Enter 100 sats
await browser_press_key({ key: '1' });
await browser_press_key({ key: '0' });
await browser_press_key({ key: '0' });
// Display now shows ₿100, Continue button is enabled
```

**Note**: Clicking on the amount display area does nothing - just start typing immediately after the page loads.

## Expected Behaviors

### Initial Load

- Navigate to `https://localhost:3000`
- May show loading logo briefly
- Redirects to `/home` if not authenticated, or `/` if authenticated
- Console shows React DevTools and Vercel Analytics messages

### Authentication Redirects

- Accessing protected routes when not logged in redirects to `/home`
- After authentication, redirects to `/` (main dashboard)
- Some auth routes may redirect through `/signup` or `/login`

### Page Transitions

- URL changes trigger page view analytics logs: `[Vercel Web Analytics] [pageview] https://localhost:3000/{path}`
- New pages may show loading states before content appears
- Images and icons may trigger preload warnings in console

### Console Messages

Normal console output includes:
- React DevTools download prompt (INFO)
- Vercel Web Analytics debug messages (LOG)
- Resource preload warnings for icons (WARNING)
- Buffer module externalization warnings (WARNING)
- During authentication: Certificate verification and attestation logs (LOG)

## Tips for Efficient Navigation

1. **Always start with authentication** - Navigate to `/signup` first if testing from scratch
2. **Use guest accounts** - Fastest way to get authenticated for testing
3. **Wait for crypto operations** - Authentication and key operations take 3-5 seconds
4. **Check URL changes** - Confirm navigation by checking `page.url`
5. **Use browser_snapshot** - Get full page state and element references efficiently
6. **Handle modals immediately** - Don't try to navigate past unclosed modals
7. **Reference elements by ref** - Use the `ref` values from snapshots for reliable interactions
8. **Expect redirects** - Protected routes redirect when not authenticated

## Troubleshooting

### "No transactions found" / Empty balances

This is expected for new accounts. The app starts with ₿0 and no transaction history.

### Stuck on "Coming Soon" page

You're on `/home` (unauthenticated). Navigate to `/signup` to create an account.

### Continue button disabled

Check that all required inputs are filled and checkboxes (like ToS) are checked.

### Authentication hangs

Wait 5-10 seconds for cryptographic operations. Check console for attestation verification logs.

### Unexpected redirects

Protected routes redirect to `/home` when not authenticated. Always authenticate first.

### Authentication Fails / Invalid Credentials

If authentication fails with errors like "Invalid email, password, or login method" or the console shows `Failed to create guest account`:

**Tell the user:**
> "Authentication failed. This usually happens when existing localStorage credentials are invalid (e.g., after a database reset or environment change)."

**Suggested fixes:**
1. **Clear localStorage and retry**: Use `browser_evaluate` to clear auth-related keys:
   ```javascript
   () => {
     localStorage.removeItem('guestAccount');
     localStorage.removeItem('access_token');
     localStorage.removeItem('refresh_token');
   }
   ```
2. **Navigate to `/signup` and create a fresh guest account** - go through the full signup flow
3. **Check if the dev server is running** - ensure `bun run dev --https` is active
4. **Verify the backend/database is accessible** - the app may be unable to reach authentication services

**Do NOT** attempt to store or reuse guest credentials across sessions - they are tied to the specific environment and database state.
