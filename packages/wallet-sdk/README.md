# @agicash/wallet-sdk

Shared, React-free wallet SDK core for Agicash. Handles auth, key derivation, and configuration. Runs headless under Bun/Node with no DOM dependency.

## What's in this package

- `Sdk.create(config)` — creates an SDK instance given Open Secret + Supabase coordinates and a storage adapter
- `sdk.auth` — sign in (guest, email, Google), sign out, session refresh
- `sdk.user` — fetch the current user profile
- `sdk.dispose()` — tear down background timers and subscriptions
- `inMemoryStorageAdapter()` — ephemeral storage for tests and headless scripts
- `browserStorageAdapter()` / `browserSessionStorageAdapter()` — DOM-backed adapters (exported from `../storage/browser`, outside `src/` to keep the headless core clean)

This is **base Plan 2: core + auth**. The remaining domains (accounts, cashu, spark, transactions, contacts, transfers, scan, rates, background), realtime, processors, and engine seams land in later base plans.

## Headless smoke example

`examples/headless-auth.ts` signs in as a guest against the local stack. It is **not** part of `bun run test` — run it manually when you have a local Supabase + Open Secret stack running.

### Required env vars

| Variable | Description |
|---|---|
| `OPEN_SECRET_URL` | Open Secret server URL (e.g. `https://localhost:3001`) |
| `OPEN_SECRET_CLIENT_ID` | Open Secret client ID |
| `SUPABASE_URL` | Supabase API URL (e.g. `https://localhost:54321`) |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |

The local stack uses self-signed TLS. Point `NODE_EXTRA_CA_CERTS` at the mkcert root CA so Node trusts it:

```sh
# Get env vars from the local stack (run from repo root):
SELF_SIGNED_CERT_PATH=../certs/ci-localhost-cert.pem bun supabase status -o env

# Then run the example:
NODE_EXTRA_CA_CERTS=~/.local/share/mkcert/rootCA.pem \
  OPEN_SECRET_URL=... OPEN_SECRET_CLIENT_ID=... \
  SUPABASE_URL=... SUPABASE_ANON_KEY=... \
  bun examples/headless-auth.ts
```
