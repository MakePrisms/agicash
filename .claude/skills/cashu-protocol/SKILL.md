---
name: cashu-protocol
description: Use this skill when the task requires referencing Cashu NUT (Notation, Usage, and Terminology) specifications for the ecash protocol on Bitcoin. Invoke for learning, explaining, implementing, or debugging Cashu concepts like minting, swapping, melting, blind signatures, keysets, or quote flows.
---

# Cashu Protocol

Provides authoritative guidance on the Cashu ecash protocol by referencing official NUT specification documents.

## Core Principle

**Always cite the exact NUT specification.** Read the relevant reference file before answering. Quote specification text for cryptographic operations, request/response formats, and state transitions. Never guess or extrapolate beyond the specification.

## Available References

All NUT specifications from https://github.com/cashubtc/nuts are in `references/`:

**Mandatory (00-06):**
- `references/00.md` - Cryptography and Models (blind signatures, BDHKE, token formats)
- `references/01.md` - Mint public keys
- `references/02.md` - Keysets and fees
- `references/03.md` - Swapping tokens
- `references/04.md` - Minting tokens
- `references/05.md` - Melting tokens
- `references/06.md` - Mint info

**Optional Extensions (07-27):**
- `references/07.md` - Token state check
- `references/08.md` - Overpaid Lightning fees
- `references/09.md` - Signature restore
- `references/10.md` - Spending conditions
- `references/11.md` - Pay-To-Pubkey (P2PK)
- `references/12.md` - DLEQ proofs
- `references/13.md` - Deterministic secrets
- `references/14.md` - Hashed Timelock Contracts (HTLCs)
- `references/15.md` - Partial multi-path payments (MPP)
- `references/16.md` - Animated QR codes
- `references/17.md` - WebSocket subscriptions
- `references/18.md` - Payment requests
- `references/19.md` - Cached responses
- `references/20.md` - Signature on mint quote
- `references/21.md` - Clear authentication
- `references/22.md` - Blind authentication
- `references/23.md` - Payment Method: BOLT11
- `references/24.md` - HTTP 402 Payment Required
- `references/25.md` - Payment Method: BOLT12
- `references/26.md` - Payment request Bech32m encoding
- `references/27.md` - Nostr mint backup

**Additional Resources:**
- `references/error_codes.md` - Standard error codes

## Usage Pattern

1. **Identify relevant NUT(s)** for the question (e.g., token swapping → NUT-03)
2. **Read the specification** file from `references/XX.md`
3. **Extract and cite** exact specification text
4. **Apply to context** - explain how the spec addresses the user's question

## Script Utility

Use `scripts/parse-nut.ts` to extract specific sections:

```bash
bun scripts/parse-nut.ts references/00.md "Variables"
```

## Updating References

To sync with upstream specifications:

```bash
cd /tmp
git clone --depth 1 https://github.com/cashubtc/nuts.git
# Copy only numbered NUT specs and error_codes, skip README.md
cp nuts/[0-9][0-9].md nuts/error_codes.md /path/to/.claude/skills/cashu-protocol/references/
```
