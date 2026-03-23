# Cashu Protocol Extensions

This document describes extensions to the Cashu protocol that are not included in the NUTs.
Currently, only the Agicash CDK fork implements these extensions for mints.

Refer to the Agicash CDK fork to see changes that have been made on the mint side:
https://github.com/MakePrisms/cdk/blob/main/crates/cdk-agicash/README.md

## NUT-06 Agicash Extension

Agicash mints extend the NUT-06 mint info response by including an `agicash` key,
which contains Agicash-specific configurations.

Example:

```json
{
  "...other fields",
  "agicash": {
    "purpose": "gift-card"
  }
}
```

### Purpose

The `purpose` field signals to wallets what type of account to create for this mint.
Defaults to `"transactional"` when absent.

| Value | Description |
|-------|-------------|
| `"transactional"` | Regular mint for sending and receiving payments. |
| `"gift-card"` | Closed-loop mint issuing gift cards. The mint only processes payments to destinations within its loop (e.g., invoices from a specific merchant). |
| `"offer"` | Promotional ecash with an expiry. Minting (NUT-04) is disabled — ecash is distributed by the mint operator, not minted by users. The keyset's `final_expiry` field indicates when the ecash expires. |

Configurable on the mint via TOML (`agicash.purpose`) or env var (`CDK_MINTD_AGICASH_PURPOSE`).

### Offer Mints

Offer mints have minting disabled (`nuts.4.disabled: true` in the standard NUT-06 info response).
Wallets should:

- **Not** show Lightning receive options for offer accounts.
- Read `final_expiry` from the mint's active keyset (via `/v1/keysets`) to determine when the offer expires.
- Hide expired offer accounts from the UI.

## Minting Fees (extends NUT-04)

Agicash mints can charge a deposit fee when minting via the bolt11 payment method.
The `PostMintQuoteBolt11Response` is extended to include an optional `fee` field
that represents the fee in the quote's unit (e.g., sats or cents).

```json
{
  "quote": "...",
  "request": "lnbc...",
  "state": "UNPAID",
  "expiry": 1234567890,
  "fee": 100
}
```

This fee is not part of the NUT-04 spec but is added by the Agicash CDK fork.
