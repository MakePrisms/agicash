# Agicash CLI

`@agicash/cli` is a Bun-based command line wallet for Cashu ecash and Lightning payments.

`v0.0.1` is cloud-only. Authenticate with OpenSecret first, then the CLI reads and writes the same Supabase-backed wallet data as the web app.

## Install

Recommended:

```bash
bun install -g @agicash/cli
agicash help
```

One-off usage:

```bash
bunx @agicash/cli help
```

`npm install -g @agicash/cli` also works if Bun is already installed on the machine, because the published executable uses `#!/usr/bin/env bun`.

## Configure

Published releases can bake in the Agicash cloud defaults at build time. Runtime overrides are resolved in this order:

1. Shell environment variables
2. `./.env`
3. `~/.agicash/.env`
4. Bundled release defaults

Create `~/.agicash/.env` when you want a global override.

Relevant runtime overrides:

```bash
OPENSECRET_CLIENT_ID=
OPENSECRET_API_URL=
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

Auth tokens and CLI config are stored in `~/.agicash/agicash.db`.

Use `--verbose` when you want SDK debug logs on `stderr` without polluting the JSON command output on `stdout`.

## First Run

```bash
agicash auth guest
agicash mint add https://testnut.cashu.space
agicash balance --pretty
```

## Maintainer Release

The release builder creates a publishable package in `dist/npm` and bakes in the public cloud configuration at build time.

Required release env vars:

```bash
AGICASH_RELEASE_OPENSECRET_CLIENT_ID=
AGICASH_RELEASE_OPENSECRET_API_URL=
AGICASH_RELEASE_SUPABASE_URL=
AGICASH_RELEASE_SUPABASE_ANON_KEY=
AGICASH_RELEASE_ENVIRONMENT=production
```

Build the release artifact:

```bash
AGICASH_RELEASE_ENVIRONMENT=production \
AGICASH_RELEASE_OPENSECRET_CLIENT_ID=... \
AGICASH_RELEASE_OPENSECRET_API_URL=... \
AGICASH_RELEASE_SUPABASE_URL=... \
AGICASH_RELEASE_SUPABASE_ANON_KEY=... \
bun run build:release
```

Preview the publish payload:

```bash
bun publish --cwd ./dist/npm --dry-run
```

Publish:

```bash
bun publish --cwd ./dist/npm --access public
```

Do not bake in secrets such as service role keys, JWT signing secrets, or user mnemonics. Only the public client-facing Supabase and OpenSecret values belong in the release bundle.
