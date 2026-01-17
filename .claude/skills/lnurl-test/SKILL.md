---
name: lnurl-test
description: Test the Lightning Address (LNURL) server endpoints against localhost:3000. Use when testing LUD-16, LUD-06, and LUD-21 endpoints for invoice creation and payment verification.
---

# LNURL Server Test Skill

Test the Lightning Address (LNURL) server functionality by validating LUD-16, LUD-06, and LUD-21 endpoints.

## Test Workflow

### Step 1: Get Username
If no username was provided when invoking this skill, ask the user for their username.

### Step 2: Test with Current Default Account

#### 2a. LUD-16 Test (Initial Request)
Use WebFetch to test: `http://localhost:3000/.well-known/lnurlp/{username}`

**Validate response contains:**
- `callback` - URL string containing `/api/lnurlp/callback/`
- `minSendable` - number (millisats)
- `maxSendable` - number (millisats)
- `metadata` - JSON string with `text/plain` entry
- `tag` - must equal `"payRequest"`

**Extract:** `userId` from the callback URL (last path segment)

#### 2b. LUD-06 Test (Invoice Creation)
Use WebFetch to test: `http://localhost:3000/api/lnurlp/callback/{userId}?amount=10000` (10 sats in millisats)

**Validate response contains:**
- `pr` - string starting with `lnbc` (Lightning invoice)
- `verify` - URL string for payment verification
- `routes` - empty array `[]`

**Extract:** The full `verify` URL

#### 2c. Wait for Auto-Pay (Testnut only)
If testing with Testnut (FakeWallet), wait 3 seconds for auto-payment to settle.

Use the Bash tool to wait: `sleep 3`

#### 2d. LUD-21 Test (Payment Verification)
Use WebFetch to test: `{verify URL from step 2b}`

**Validate response contains:**
- `status` - must equal `"OK"`
- `settled` - boolean (true for Testnut, false for Spark)
- `pr` - string matching the invoice from step 2b

### Step 3: Ask User to Switch Default Account
After completing the test with one account type:
1. Report the results so far
2. Ask the user to switch their default account in the app:
   - If tested with Testnut → "Please switch your default account to Spark and let me know when ready"
   - If tested with Spark → "Please switch your default account to Testnut and let me know when ready"
3. Repeat Step 2 with the other account type

### Step 4: Report Final Results

Use this format:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LNURL SERVER TEST RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Username: {username}
Lightning Address: {username}@localhost:3000

TEST: TESTNUT Account
  LUD-16 (Initial Request): ✓ PASS / ✗ FAIL
  LUD-06 (Invoice Creation): ✓ PASS / ✗ FAIL
  LUD-21 (Payment Verify):   ✓ PASS / ✗ FAIL
    - settled: true (expected for Testnut FakeWallet)

TEST: SPARK Account
  LUD-16 (Initial Request): ✓ PASS / ✗ FAIL
  LUD-06 (Invoice Creation): ✓ PASS / ✗ FAIL
  LUD-21 (Payment Verify):   ✓ PASS / ✗ FAIL
    - settled: false (expected - no actual payment)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Expected Response Schemas

**LUD-16 Response:**
```json
{
  "callback": "http://localhost:3000/api/lnurlp/callback/{userId}",
  "maxSendable": 1000000000,
  "minSendable": 1000,
  "metadata": "[[\"text/plain\",\"Pay to user@localhost:3000\"]]",
  "tag": "payRequest"
}
```

**LUD-06 Response:**
```json
{
  "pr": "lnbc100n1p...",
  "verify": "http://localhost:3000/api/lnurlp/verify/encrypted...",
  "routes": []
}
```

**LUD-21 Response:**
```json
{
  "status": "OK",
  "settled": true,
  "preimage": "abc123...",
  "pr": "lnbc100n1p..."
}
```

## Key Implementation Files

| File | Purpose |
|------|---------|
| `app/routes/[.]well-known.lnurlp.$username.ts` | LUD-16 endpoint |
| `app/routes/api.lnurlp.callback.$userId.ts` | LUD-06 callback |
| `app/routes/api.lnurlp.verify.$encryptedQuoteData.ts` | LUD-21 verify |
| `app/features/receive/lightning-address-service.tsx` | Core LNURL service |

## Notes

- **Testnut FakeWallet**: Automatically pays invoices, so `settled` should be `true` after waiting
- **Spark Account**: No auto-payment, so `settled` should be `false`
- Always test against `localhost:3000` (dev server must be running)
- The `amount` parameter in LUD-06 is in **millisatoshis** (10000 = 10 sats)
