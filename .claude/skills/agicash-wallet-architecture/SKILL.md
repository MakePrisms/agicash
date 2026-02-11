---
name: agicash-wallet-architecture
description: Agicash wallet system architecture — components, their responsibilities, and interactions. Use when working on cross-component concerns like server routes, client-server communication, Open Secret integration, encryption/decryption flows, Supabase Realtime subscriptions, or when deciding where new functionality should live (server vs client). Also use when modifying Lightning Address routes, SSR behavior, or database access patterns.
---

# Agicash Wallet Architecture

Read [docs/architecture.md](../../../docs/architecture.md) for the full architecture overview with diagrams.

## Component Summary

Four components — understand their boundaries before making changes:

| Component | Responsibility | Key constraint |
|-----------|---------------|----------------|
| **Server** (Vercel) | Serves client code, handles offline requests (Lightning Address, Sentry tunnel, PWA manifest) | Cannot access Open Secret — no seeds, no encryption keys |
| **Client** (Browser) | Runs the wallet — auth, wallet init, encrypt/decrypt, read/write DB | All sensitive operations happen here |
| **Open Secret** (AWS Nitro Enclave) | Stores auth, seeds, mnemonics, encryption keys | Data only accessible after user authentication |
| **Postgres DB** (Supabase) | Stores wallet data with RLS | Sensitive data stored encrypted, each user reads only their own |

## When to Consult the Architecture Doc

- **Adding a new server route or API endpoint** — check what the server can and cannot access (no Open Secret, only non-sensitive DB data via service role key)
- **Working with encryption/decryption** — understand the client-side-only encryption model and why the server cannot decrypt
- **Modifying auth or key derivation** — understand the Open Secret → Supabase JWT flow
- **Adding or changing Realtime subscriptions** — understand the client ↔ DB realtime pattern
- **Deciding server vs client for new functionality** — the architecture doc clarifies the boundary: if it needs seeds, keys, or decrypted data, it must be client-side
