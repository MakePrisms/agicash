---
name: agicash-cli
description: Use when running agicash CLI commands, scripting wallet operations, or building automation around Cashu ecash and Lightning payments from the terminal
---

# Agicash CLI

Self-custody Cashu ecash + Lightning wallet CLI. JSON output by default, `--pretty` for humans. Exit 0 = success (stdout), exit 1 = error (stderr).

## Setup

```bash
# 1. Configure the cloud environment (for local development):
export OPENSECRET_CLIENT_ID="your-opensecret-client-id"
export OPENSECRET_API_URL="https://your-opensecret-api.example.com"
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-supabase-anon-key"

# 2. Run via bun (dev):
bun run --cwd packages/cli src/main.ts <command> [args] [flags]
# Or installed binary:
agicash <command> [args] [flags]
```

**Cloud-only in `v0.0.1`.** Authenticate with `agicash auth login` or `agicash auth guest` before wallet commands like `mint`, `balance`, `receive`, `send`, and `pay`. Published releases can bake the public cloud defaults in at build time, while local overrides load from `~/.agicash/.env` and `./.env`.

**First-run workflow:** `auth guest` → `mint add <url>` → `balance`

## Commands

### mint add \<url\>
Add a Cashu mint. Validates reachability and unit support before storing.
```bash
agicash mint add https://testnut.cashu.space
agicash mint add https://mint.example.com --currency USD --name "My USD Mint"
```
Flags: `--currency BTC|USD` (default: BTC), `--name "..."` (default: "\<currency\> Mint")

### mint list
```bash
agicash mint list
```

### balance
```bash
agicash balance --pretty
```
Returns `{ accounts: [...], totals: { BTC: 1000, USD: 500 } }`. Amounts in sats (BTC) or cents (USD).

### receive \<amount|token\>
**Two modes** — detected automatically:
- **Number** → creates Lightning invoice for that many sats
- **cashuA.../cashuB...** → claims a Cashu token

```bash
# Create invoice for 100 sats:
agicash receive 100
# Claim a token:
agicash receive cashuAeyJ...
```
Flags: `--account <id>`, `--wait` (poll until paid, 5min timeout), `--check <quote-id>` (check/mint a previous quote)

**Workflow — receive via Lightning:**
```bash
RESULT=$(agicash receive 100)
QUOTE_ID=$(echo "$RESULT" | jq -r '.quote.id')
BOLT11=$(echo "$RESULT" | jq -r '.quote.bolt11')
# Pay the bolt11 externally, then:
agicash receive --check "$QUOTE_ID"
```

### send \<amount\>
Create a Cashu ecash token (sats). Selects proofs from default account.
```bash
agicash send 50
# Output includes .token.encoded — share this string to send ecash
```
Flags: `--account <id>`

### pay \<invoice\>
Pay a Lightning invoice by melting ecash proofs.
```bash
agicash pay lnbc500n1p...
```
Flags: `--account <id>`

### decode \<input\>
Universal parser — bolt11, cashu token, Lightning address, LNURL, URL.
```bash
agicash decode lnbc500n1p...
agicash decode satoshi@bitcoin.org
agicash decode cashuAeyJ...
```
No DB access needed.

### watch
Foreground daemon — starts all background task processors and Supabase realtime handler. Watches pending quotes/swaps and auto-completes them. Outputs NDJSON events to stdout. Runs until SIGINT (Ctrl+C).

```bash
# Watch all processors:
agicash watch
# Receive-only:
agicash watch --receive
# Send-only:
agicash watch --send
# With SDK debug logs on stderr:
agicash watch --verbose
```

**Events emitted:**
```json
{"event":"watch:started","processors":["cashuReceiveQuote",...],"filters":"all","ts":"..."}
{"event":"receive:minted","quoteId":"...","amount":"...","accountId":"...","ts":"..."}
{"event":"receive:swap:completed","tokenHash":"...","ts":"..."}
{"event":"send:completed","quoteId":"...","ts":"..."}
{"event":"send:failed","quoteId":"...","reason":"...","ts":"..."}
{"event":"error","processor":"...","action":"...","message":"...","ts":"..."}
{"event":"watch:stopping","ts":"..."}
```

**Agent workflow — fire and forget:**
```bash
# Terminal 1: start daemon
agicash watch &

# Terminal 2: fire commands
agicash receive 100    # creates invoice, returns quote ID
agicash send 50        # creates token, returns immediately

# Watch auto-completes pending quotes in the background.
# Tail stdout or use tmux capture-pane to read events.
```

### auth
```bash
agicash auth login <email> <password>
agicash auth signup <email> <password>
agicash auth guest        # create/re-use guest account (for testing)
agicash auth logout
agicash auth status       # show current auth state
agicash auth whoami       # alias for status
```

### receive list / --check-all
```bash
agicash receive list          # list all pending quotes
agicash receive --check-all   # recheck all pending quotes and mint paid ones
```

### config
```bash
agicash config list
agicash config get default-btc-account
agicash config set default-btc-account <account-id>
```
Valid keys: `default-btc-account`, `default-usd-account`

## Output Format

**Success:** `{"action":"created","token":{"encoded":"cashuA...","amount":50,...}}`
**Error:** `{"error":"message","code":"ERROR_CODE"}` on stderr, exit 1

**receive success (invoice):** `{"action":"invoice","quote":{"id":"...","bolt11":"lnbc...","amount":42,"state":"UNPAID",...}}`
**receive success (minted):** `{"action":"minted","minted":{"amount":42,"proof_count":6,"account_id":"..."}}`
**receive pending:** `{"action":"pending","quote":{"id":"...","state":"UNPAID",...}}`
**send success:** `{"action":"created","token":{"encoded":"cashuA...","amount":50,"mint_url":"...","proof_count":3}}`
**pay success:** `{"action":"paid","payment":{"bolt11":"...","amount":50,"fee":0,"mint_url":"..."}}`
**decode success:** `{"type":"bolt11|cashu_token|lightning_address|lnurl|url","raw":"...","data":{...}}`

Common error codes: `MISSING_AMOUNT`, `INVALID_AMOUNT`, `NO_ACCOUNT` (includes insufficient balance), `DUPLICATE_MINT`, `MINT_UNREACHABLE`, `UNSUPPORTED_UNIT`, `SEND_FAILED`, `RECEIVE_TOKEN_FAILED`, `PAY_FAILED`

## Global Flags

| Flag | Effect |
|------|--------|
| `--pretty` | Indented JSON output |
| `--verbose` | Write SDK debug logs to stderr |
| `--account <id>` | Target specific account (send/pay/receive) |
| `--receive` | Filter watch to receive processors only |
| `--send` | Filter watch to send processors only |
| `--help` / `-h` | Show help |
| `--version` / `-v` | Show version |

## Database

SQLite at `~/.agicash/agicash.db` stores auth tokens, CLI config, and guest credentials. Reset by deleting the file.

## Test Mint

`https://testnut.cashu.space` is a test mint that auto-pays invoices. Useful for testing flows without real bitcoin.

## Agent Tips

- **Tokens and invoices must be sent as a single standalone message** — no surrounding text, no code blocks, no explanation in the same message. This makes them easy to copy on mobile. Send the explanation in a separate message before or after.
- Parse JSON output with `jq` — all success responses go to stdout
- Check exit code before parsing: `if agicash send 50; then ...`
- Use `--account` when multiple mints exist to avoid wrong-account selection
- `decode` is stateless (no DB) — safe to call freely for input detection
- `receive` auto-detects: integers = Lightning, cashuA/cashuB prefix = token claim
- Run `watch` in a background tmux pane to get notified of payment completions without polling
