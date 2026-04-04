# Breez Spark SDK Prototype Validation (Phase C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate that Breez Spark SDK (`@breeztech/breez-sdk-spark`) is a viable replacement for `@buildonspark/spark-sdk` by testing key derivation compatibility, balance reliability, event reliability, optimization behavior, fees, and init performance.

**Architecture:** Install Breez SDK alongside the existing Spark SDK (no production code changes). Build a temporary test page at `/test/breez` behind the `_protected` layout to run validation experiments on real mobile devices. Each validation step (C1-C7) produces documented results that inform the Phase A production replacement plan.

**Tech Stack:** `@breeztech/breez-sdk-spark` (WASM), React, TanStack Query, existing Open Secret auth for mnemonic access.

**Spec:** `docs/superpowers/specs/2026-04-04-breez-spark-sdk-migration-design.md`

---

## File Structure

All files in this phase are temporary — they'll be removed after validation.

| File | Purpose |
|------|---------|
| `app/lib/breez-spark/init.ts` | Breez SDK initialization: `init()` WASM setup, `connect()` wrapper, seed construction |
| `app/lib/breez-spark/events.ts` | Event listener setup and logging for all Breez SDK events |
| `app/routes/_protected.test.breez.tsx` | Test page UI: shows both SDK balances, events log, action buttons for all C-step experiments |

---

### Task 1: Install Breez SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
bun add @breeztech/breez-sdk-spark
```

- [ ] **Step 2: Verify TypeScript types ship with the package**

```bash
ls node_modules/@breeztech/breez-sdk-spark/*.d.ts 2>/dev/null || ls node_modules/@breeztech/breez-sdk-spark/dist/*.d.ts 2>/dev/null || echo "No .d.ts files found at top level — check package structure"
```

Explore the package structure to understand the exports and type definitions:

```bash
ls node_modules/@breeztech/breez-sdk-spark/
cat node_modules/@breeztech/breez-sdk-spark/package.json | head -30
```

Document findings: what's the main export, are there subpath exports, what types are available.

- [ ] **Step 3: Verify WASM files are included**

```bash
find node_modules/@breeztech/breez-sdk-spark -name "*.wasm" -o -name "*wasm*" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add @breeztech/breez-sdk-spark for prototype validation"
```

---

### Task 2: Breez SDK Initialization Module

**Files:**
- Create: `app/lib/breez-spark/init.ts`

This module wraps Breez SDK initialization. It needs to:
1. Call `init()` for WASM setup (required on web before any other SDK call)
2. Construct seed from mnemonic
3. Call `connect()` with config (network, API key) and seed

- [ ] **Step 1: Explore Breez SDK exports and types**

Before writing any code, read the package's type definitions to understand the actual API:

```bash
cat node_modules/@breeztech/breez-sdk-spark/dist/index.d.ts 2>/dev/null | head -100
```

Look for: `init`, `connect`, `defaultConfig`, `Seed`, `Network`, `BreezSdk` (or whatever the SDK instance type is called). Document the actual function signatures and type names — they may differ from the documentation.

- [ ] **Step 2: Create the initialization module**

Create `app/lib/breez-spark/init.ts`. The API key should come from an environment variable `BREEZ_API_KEY`.

Use the actual types and function names discovered in Step 1. The structure should be:

```typescript
// app/lib/breez-spark/init.ts
//
// Pseudocode — replace with actual Breez SDK imports and types from Step 1:
//
// import { init, connect, defaultConfig, Seed } from '@breeztech/breez-sdk-spark'
//
// let initialized = false
//
// export async function initBreezWasm() {
//   if (initialized) return
//   await init()
//   initialized = true
// }
//
// export async function connectBreezWallet(mnemonic: string) {
//   await initBreezWasm()
//   const config = defaultConfig('mainnet')  // or whatever the actual API is
//   config.apiKey = '<breez api key>'         // from env var or hardcoded for prototype
//   const seed = { type: 'mnemonic', mnemonic, passphrase: undefined }
//   return connect({ config, seed })
// }
```

Adapt to the actual SDK API. The key contract is:
- `initBreezWasm()` — idempotent WASM init, must be called before any SDK usage
- `connectBreezWallet(mnemonic: string)` — returns the SDK instance

- [ ] **Step 3: Verify it compiles**

```bash
bun run fix:all
```

Fix any type errors. This is where you'll discover if the SDK types match what we expect.

- [ ] **Step 4: Commit**

```bash
git add app/lib/breez-spark/
git commit -m "feat: add Breez Spark SDK initialization module"
```

---

### Task 3: Breez Event Listener Module

**Files:**
- Create: `app/lib/breez-spark/events.ts`

- [ ] **Step 1: Read Breez SDK event types**

Check the SDK types for event-related exports:

```bash
grep -i "event\|listener\|SdkEvent" node_modules/@breeztech/breez-sdk-spark/dist/*.d.ts 2>/dev/null | head -30
```

Look for: event type enum/union, listener interface, `addEventListener`/`removeEventListener` methods on the SDK instance.

- [ ] **Step 2: Create the events module**

Create `app/lib/breez-spark/events.ts` that:
- Defines an event listener class matching the SDK's listener interface
- Logs all events with timestamps to a callback (for the test UI to display)
- Registers/unregisters with the SDK instance

```typescript
// app/lib/breez-spark/events.ts
//
// Pseudocode — replace with actual types from Step 1:
//
// import type { SdkEvent } from '@breeztech/breez-sdk-spark'
//
// type EventLogEntry = {
//   timestamp: Date
//   type: string
//   data: unknown
// }
//
// type OnEventCallback = (entry: EventLogEntry) => void
//
// export function createEventListener(onEvent: OnEventCallback) {
//   return {
//     onEvent: async (event: SdkEvent) => {
//       onEvent({
//         timestamp: new Date(),
//         type: event.type,
//         data: event,
//       })
//     }
//   }
// }
```

- [ ] **Step 3: Verify it compiles**

```bash
bun run fix:all
```

- [ ] **Step 4: Commit**

```bash
git add app/lib/breez-spark/events.ts
git commit -m "feat: add Breez Spark SDK event listener module"
```

---

### Task 4: C1 — Key Derivation Compatibility Test

**Files:**
- Create: `app/routes/_protected.test.breez.tsx`

This is the dealbreaker check. Derive identity public key from the same mnemonic using both SDKs and compare.

- [ ] **Step 1: Read current key derivation code**

Read `app/lib/spark/utils.ts` lines 73-91 to understand how the current SDK derives the identity public key. The function is `getSparkIdentityPublicKeyFromMnemonic`.

- [ ] **Step 2: Find Breez SDK's identity key method**

Check the SDK instance type for a method like `getIdentityPublicKey`, `getInfo`, `signMessage`, or similar:

```bash
grep -i "identity\|public.key\|getInfo\|sign" node_modules/@breeztech/breez-sdk-spark/dist/*.d.ts 2>/dev/null | head -20
```

The Breez SDK's `get_info` method may return wallet info including the identity public key. Or `sign_message` uses the identity key. Discover the actual method.

- [ ] **Step 3: Create the test page**

Create `app/routes/_protected.test.breez.tsx`. This route is behind auth so it has access to the user's mnemonic via Open Secret.

The page should:
1. Fetch the Spark mnemonic using `sparkMnemonicQueryOptions()`
2. Derive identity public key using current SDK (`getSparkIdentityPublicKeyFromMnemonic`)
3. Initialize Breez wallet using `connectBreezWallet(mnemonic)`
4. Get identity public key from Breez SDK (method from Step 2)
5. Display both keys side by side with a MATCH / MISMATCH indicator

```tsx
// app/routes/_protected.test.breez.tsx
import { useSuspenseQuery } from '@tanstack/react-query'
import { sparkMnemonicQueryOptions } from '~/features/shared/spark'
import { getSparkIdentityPublicKeyFromMnemonic } from '~/lib/spark'
import { connectBreezWallet } from '~/lib/breez-spark/init'
import { useState } from 'react'

export default function BreezTestPage() {
  const { data: mnemonic } = useSuspenseQuery(sparkMnemonicQueryOptions())
  const [results, setResults] = useState<{
    currentSdkKey: string
    breezSdkKey: string
    match: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runKeyDerivationTest = async () => {
    try {
      // Current SDK
      const currentSdkKey = await getSparkIdentityPublicKeyFromMnemonic(
        mnemonic,
        'MAINNET',
      )

      // Breez SDK
      const sdk = await connectBreezWallet(mnemonic)
      // TODO: Replace with actual Breez method to get identity public key
      // const info = await sdk.getInfo()
      // const breezSdkKey = info.identityPublicKey
      const breezSdkKey = 'TODO: get from SDK'

      setResults({
        currentSdkKey,
        breezSdkKey,
        match: currentSdkKey === breezSdkKey,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="p-4 font-mono text-sm">
      <h1 className="text-lg font-bold mb-4">Breez SDK Prototype Validation</h1>

      <section className="mb-6">
        <h2 className="font-bold mb-2">C1: Key Derivation Compatibility</h2>
        <button
          type="button"
          onClick={runKeyDerivationTest}
          className="bg-blue-600 text-white px-4 py-2 rounded mb-2"
        >
          Run Key Derivation Test
        </button>

        {error && <p className="text-red-500">Error: {error}</p>}

        {results && (
          <div className="space-y-1">
            <p>Current SDK: {results.currentSdkKey}</p>
            <p>Breez SDK: {results.breezSdkKey}</p>
            <p className={results.match ? 'text-green-500 font-bold' : 'text-red-500 font-bold'}>
              {results.match ? 'MATCH' : 'MISMATCH — DEALBREAKER'}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
```

Adapt the Breez SDK calls to the actual API discovered in Steps 1-2.

- [ ] **Step 4: Run dev server and test**

```bash
bun run dev
```

Navigate to `http://127.0.0.1:3000/test/breez` (after logging in). Click "Run Key Derivation Test".

**Expected result:** Both keys should be identical hex strings. If they don't match, **stop here** and report the mismatch — this is a dealbreaker.

- [ ] **Step 5: Commit**

```bash
git add app/routes/_protected.test.breez.tsx
git commit -m "feat: add C1 key derivation compatibility test page"
```

---

### Task 5: C2/C3 — Balance and Event Reliability Tests

**Files:**
- Modify: `app/routes/_protected.test.breez.tsx`

Add balance display and event logging to the test page.

- [ ] **Step 1: Find Breez balance and payment list methods**

```bash
grep -i "getInfo\|get_info\|balance\|listPayments\|list_payments" node_modules/@breeztech/breez-sdk-spark/dist/*.d.ts 2>/dev/null | head -20
```

Discover: how to get balance (likely `sdk.getInfo()` returns balance), how to list payments.

- [ ] **Step 2: Add balance comparison section**

Add to the test page:
- Current SDK balance (from existing `sparkWalletQueryOptions` → `wallet.getBalance()`)
- Breez SDK balance (from `sdk.getInfo()` or equivalent)
- Auto-refresh both every 3 seconds to match current polling behavior
- Side-by-side display

```tsx
// Add to the test page component:

// Breez balance section
const [breezBalance, setBreezBalance] = useState<string | null>(null)
const [breezSdk, setBreezSdk] = useState</* SDK type */ | null>(null)

const initBreezAndFetchBalance = async () => {
  const sdk = await connectBreezWallet(mnemonic)
  setBreezSdk(sdk)
  // TODO: Replace with actual balance method
  // const info = await sdk.getInfo()
  // setBreezBalance(String(info.balanceSats))
}

// Poll breez balance
useEffect(() => {
  if (!breezSdk) return
  const interval = setInterval(async () => {
    // const info = await breezSdk.getInfo()
    // setBreezBalance(String(info.balanceSats))
  }, 3000)
  return () => clearInterval(interval)
}, [breezSdk])
```

- [ ] **Step 3: Add event log section**

Add to the test page:
- Use `createEventListener` from `app/lib/breez-spark/events.ts`
- Register the listener with the Breez SDK instance
- Display events in a scrollable list with timestamps
- Color code: green for success events, yellow for pending, red for failed

```tsx
// Add to the test page:
const [eventLog, setEventLog] = useState<EventLogEntry[]>([])

// After SDK init:
const listener = createEventListener((entry) => {
  setEventLog((prev) => [entry, ...prev].slice(0, 100)) // Keep last 100
})
// TODO: Replace with actual addEventListener call
// const listenerId = await sdk.addEventListener(listener)
```

- [ ] **Step 4: Add manual send/receive triggers**

Add buttons:
- "Create Invoice (Breez)" — calls `sdk.receivePayment({ type: 'bolt11Invoice', amountSats: 100 })` and displays the bolt11 string / QR
- "Create Invoice (Current)" — calls current SDK `wallet.createLightningInvoice({ amountSats: 100 })` for comparison
- Both should show the invoice string so you can pay from an external wallet

This enables testing C2 (does balance update after receive?) and C3 (do events fire?).

- [ ] **Step 5: Verify it compiles and run**

```bash
bun run fix:all && bun run dev
```

- [ ] **Step 6: Commit**

```bash
git add app/routes/_protected.test.breez.tsx
git commit -m "feat: add C2/C3 balance and event reliability tests"
```

- [ ] **Step 7: Manual mobile testing**

Test on actual mobile device:
1. Open test page on phone browser
2. Create an invoice via Breez SDK
3. Pay it from another wallet
4. Observe: does the Breez balance update? Do events fire? Compare with current SDK behavior.
5. Repeat for sends
6. Document results

---

### Task 6: C4 — Optimization Behavior Test

**Files:**
- Modify: `app/routes/_protected.test.breez.tsx`

- [ ] **Step 1: Find optimization methods**

```bash
grep -i "optim" node_modules/@breeztech/breez-sdk-spark/dist/*.d.ts 2>/dev/null | head -20
```

Look for: `startLeafOptimization`, `cancelLeafOptimization`, `getLeafOptimizationProgress`, and how auto-optimization is configured.

- [ ] **Step 2: Add optimization section to test page**

Add:
- Display current optimization status (polling `getLeafOptimizationProgress` or equivalent)
- "Start Optimization" button
- "Cancel Optimization" button
- Balance display that highlights any jumps (track previous balance, show delta)
- Log optimization events from the event listener

```tsx
// Add to test page:
const [optimizationStatus, setOptimizationStatus] = useState<string>('unknown')
const [balanceHistory, setBalanceHistory] = useState<{ time: Date; balance: string }[]>([])

// Track balance changes to detect jumps
useEffect(() => {
  if (breezBalance) {
    setBalanceHistory((prev) => [...prev, { time: new Date(), balance: breezBalance }].slice(-50))
  }
}, [breezBalance])
```

- [ ] **Step 3: Verify it compiles**

```bash
bun run fix:all
```

- [ ] **Step 4: Commit**

```bash
git add app/routes/_protected.test.breez.tsx
git commit -m "feat: add C4 optimization behavior tests"
```

- [ ] **Step 5: Manual testing**

1. Start optimization via the button
2. Watch balance — does it jump? Does it stay stable?
3. While optimization is running, try to create a send — does the SDK handle it?
4. Try cancelling optimization mid-way
5. Document results

---

### Task 7: C5/C6 — Fee Comparison and Init Performance

**Files:**
- Modify: `app/routes/_protected.test.breez.tsx`

- [ ] **Step 1: Find Breez fee estimation method**

```bash
grep -i "prepare.*send\|prepareSend\|fee" node_modules/@breeztech/breez-sdk-spark/dist/*.d.ts 2>/dev/null | head -20
```

- [ ] **Step 2: Add fee comparison section**

Add a section that:
- Takes a bolt11 invoice as input
- Calls current SDK `getLightningSendFeeEstimate` and Breez `prepare_send_payment` (or equivalent)
- Displays both fee estimates side by side

```tsx
// Add to test page:
const [invoiceInput, setInvoiceInput] = useState('')
const [feeComparison, setFeeComparison] = useState<{
  currentSdkFee: number
  breezSdkFee: number
} | null>(null)

const compareFees = async () => {
  // Current SDK
  const currentFee = await sparkWallet.getLightningSendFeeEstimate({
    amountSats: /* parsed from invoice */,
    encodedInvoice: invoiceInput,
  })

  // Breez SDK
  // TODO: Replace with actual prepare_send_payment call
  // const prepared = await breezSdk.prepareSendPayment({
  //   destination: { type: 'bolt11', invoice: invoiceInput },
  // })
  // const breezFee = prepared.fee

  setFeeComparison({ currentSdkFee: currentFee, breezSdkFee: /* breezFee */ })
}
```

- [ ] **Step 3: Add init performance section**

Add timing measurements:
- "Measure Current SDK Init" — times `SparkWallet.initialize()` with a fresh query (staleTime: 0)
- "Measure Breez SDK Init (Cold)" — clears IndexedDB, then times `connect()`
- "Measure Breez SDK Init (Warm)" — times `connect()` with existing IndexedDB
- Display results in milliseconds

```tsx
const [initTimes, setInitTimes] = useState<{
  currentSdk?: number
  breezCold?: number
  breezWarm?: number
}>({})

const measureCurrentSdkInit = async () => {
  const start = performance.now()
  await queryClient.fetchQuery({
    ...sparkWalletQueryOptions({ network: 'MAINNET', mnemonic }),
    staleTime: 0,
  })
  setInitTimes((prev) => ({ ...prev, currentSdk: performance.now() - start }))
}

const measureBreezInit = async () => {
  const start = performance.now()
  await connectBreezWallet(mnemonic)
  const elapsed = performance.now() - start
  // First call is "cold" if no prior IndexedDB state
  // Second call would be "warm"
  setInitTimes((prev) => ({
    ...prev,
    [prev.breezCold === undefined ? 'breezCold' : 'breezWarm']: elapsed,
  }))
}
```

- [ ] **Step 4: Verify it compiles**

```bash
bun run fix:all
```

- [ ] **Step 5: Commit**

```bash
git add app/routes/_protected.test.breez.tsx
git commit -m "feat: add C5/C6 fee comparison and init performance tests"
```

- [ ] **Step 6: Manual testing**

1. Generate test invoices at various amounts (100, 1000, 10000, 100000 sats)
2. Compare fees — document any significant differences
3. Measure init times on desktop and mobile — document results
4. Run cold init (clear browser data first) then warm init — compare

---

### Task 8: C7 — Error Catalog

**Files:**
- Modify: `app/routes/_protected.test.breez.tsx`

- [ ] **Step 1: Add error testing section**

Add buttons that deliberately trigger errors:
- "Send more than balance" — calls `prepare_send_payment` with an amount exceeding balance
- "Pay already-paid invoice" — pays an invoice that's already been paid
- "Send to invalid invoice" — sends to garbage bolt11 string
- "Connect with invalid API key" — tries `connect()` with a bad key

Each button should catch the error and display:
- Error type/class name (`error.constructor.name`)
- Error message
- Any error code or additional properties
- Full JSON.stringify of the error for inspection

```tsx
const [errorCatalog, setErrorCatalog] = useState<{
  scenario: string
  errorType: string
  message: string
  raw: string
}[]>([])

const testError = async (scenario: string, fn: () => Promise<void>) => {
  try {
    await fn()
    setErrorCatalog((prev) => [...prev, {
      scenario,
      errorType: 'NO ERROR',
      message: 'Expected an error but none was thrown',
      raw: '',
    }])
  } catch (error) {
    setErrorCatalog((prev) => [...prev, {
      scenario,
      errorType: error?.constructor?.name ?? typeof error,
      message: error instanceof Error ? error.message : String(error),
      raw: JSON.stringify(error, Object.getOwnPropertyNames(error ?? {}), 2),
    }])
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
bun run fix:all
```

- [ ] **Step 3: Commit**

```bash
git add app/routes/_protected.test.breez.tsx
git commit -m "feat: add C7 error catalog tests"
```

- [ ] **Step 4: Manual testing**

Run each error scenario and document:
- Insufficient balance: what error type? What message? Is it distinguishable?
- Already paid invoice: what error type?
- Invalid invoice: what error type?
- Network errors: what happens when offline?

Save findings — these will inform the error mapping in Phase A.

---

### Task 9: Document Results and Clean Decision

No code changes. This is the decision gate.

- [ ] **Step 1: Create results document**

Create `docs/superpowers/specs/2026-04-04-breez-spark-sdk-validation-results.md` documenting:

- C1: Key match? Yes/No — if No, stop.
- C2: Balance reliability on mobile — better/same/worse than current SDK?
- C3: Event reliability — can events replace polling? Which events fire reliably?
- C4: Optimization — balance stable during optimization? Auto-cancel on send works?
- C5: Fee comparison — Breez fees vs current SSP fees at various amounts
- C6: Init performance — cold/warm times for both SDKs, desktop vs mobile
- C7: Error catalog — table of error scenarios, types, messages, distinguishability

Include a clear GO / NO-GO recommendation.

- [ ] **Step 2: Commit results**

```bash
git add docs/superpowers/specs/2026-04-04-breez-spark-sdk-validation-results.md
git commit -m "docs: add Breez Spark SDK validation results"
```

- [ ] **Step 3: If GO — proceed to Phase A plan**

Write the Phase A implementation plan based on validation findings. The Phase A plan will be in a separate document with precise error mappings and API calls based on what was discovered during Phase C.

- [ ] **Step 4: If NO-GO — document why and clean up**

Remove the test page and Breez SDK dependency:

```bash
rm app/routes/_protected.test.breez.tsx
rm -rf app/lib/breez-spark/
bun remove @breeztech/breez-sdk-spark
git add -A
git commit -m "chore: remove Breez SDK prototype — validation failed"
```
