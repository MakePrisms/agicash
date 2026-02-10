# Cross-Account Token Claim

Orchestrates receiving a Cashu token when same-mint swap is not possible or the user chooses a different destination.

## When This Applies

`ClaimCashuTokenService.claimToken()` routes here when:
- Token's mint differs from destination account's mint
- Token's currency differs from destination account's currency
- Destination is a Spark account (not Cashu)

Same-mint, same-currency, same-type claims use `CashuReceiveSwap` instead (see `cashu-receive-swap.md`).

## Routing Decision Tree

```
Token arrives → claimToken(user, token, claimTo: 'cashu' | 'spark')
  │
  ▼
Resolve accounts
  - Source: find/build Cashu account for token's mint
  - Destination: user's default account (or preferred via claimTo)
  - Unknown mint? Auto-create account
  │
  ▼
isClaimingToSameCashuAccount()?
(same type=cashu, same currency, same mint URL)
  │
  ├─ YES → CashuReceiveSwap (see cashu-receive-swap.md)
  │
  └─ NO → Cross-Account Lightning Payment
           │
           ├─ Cashu destination → CashuReceiveQuote (type: CASHU_TOKEN)
           └─ Spark destination → SparkReceiveQuote (type: CASHU_TOKEN)
```

## Cross-Account Flow

```
1. Compute cashu proof fees on source mint
2. Iterative fee-fitting (up to 5 attempts):
   a) Get Lightning invoice on destination (mint quote or Spark invoice)
   b) Get melt quote on source mint for that invoice
   c) If melt cost fits within token value → proceed
   d) If not → reduce amount by overshoot, retry
3. Persist receive quote (Cashu or Spark) + melt data in tokenReceiveData
4. Melt proofs on source mint (pays Lightning invoice)
5. Complete on destination:
   - Cashu: wait for mint quote PAID → mint proofs → COMPLETED
   - Spark: poll getLightningReceiveRequest() → PAID
```

## Iterative Fee-Fitting

Solves the chicken-and-egg problem: you need an invoice to get a melt quote, but the melt fee may exceed the budget.

```
targetAmount = tokenAmount - cashuProofFees
amountToMelt = targetAmount

for attempt 1..5:
  amountToMint = amountToMelt.convert(destCurrency, exchangeRate)
  invoice = getInvoice(destination, amountToMint)
  meltQuote = sourceMint.createMeltQuote(invoice)
  required = meltQuote.amount + meltQuote.fee_reserve
  diff = required - targetAmount
  if diff <= 0: return quotes  // fits within budget
  amountToMelt -= diff          // reduce by overshoot, retry
```

Typically converges in 1–2 iterations.

## Account Selection

`getDefaultReceiveAccount()` priority:
1. Source can't send to Lightning (test mint / gift card)? → force source account
2. Preferred account via `claimTo` param? → use if canReceive
3. User's default account for token's currency? → use if canReceive
4. Source account itself? → use if canReceive (same-mint fallback)
5. None → claim fails

## Files

```
app/features/receive/
├── claim-cashu-token-service.ts             # Top-level orchestrator
├── receive-cashu-token-service.ts           # Account discovery & selection
├── receive-cashu-token-quote-service.ts     # Cross-account quote creation (fee-fitting)
└── receive-cashu-token-models.ts            # Types: TokenFlags, isClaimingToSameCashuAccount()
```
