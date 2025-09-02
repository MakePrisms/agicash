# Agicash Agent Guidelines

## Project Overview

- **Framework**: React Router framework mode (hosted on Vercel but in development running on Express server)
- **Development**: Nix + devenv, Bun for scripts/tests
- **Database**: Supabase with migrations in `supabase/migrations`

See .cursor/rules for more detailed instructions on how to make changes. Use the rules sparingly based on the changes you are trying to make.

## Directory Structure

- `app/components/` – Reusable UI components
- `app/lib/` – Non-app specific reusable libs
- `app/features/` –  agicash wallet application feature-specific code.(see `GUIDELINES.md`)
- `app/routes/` – React router routes from React Router v7 framework mode
- `e2e/` – Playwright tests
- `supabase/`
    ├── migrations/           # Database migration files
    ├── database.types.ts     # Generated TypeScript types
    └── config.toml          # Supabase configuration

Use **kebab-case** for files/directories. Follow hierarchy in `GUIDELINES.md`.

## Development

- Run `bun run fix:all` for lint, format, and type checks
- After schema changes: `bun run db:generate-types`
- Tests: `bun test` (unit), `bun run test:e2e` (e2e)

## React Guidelines

- Keep components focused on UI rendering and move business logic to custom hooks
- Use `useEffect` for side effects (except data fetching)
- Use **@tanstack/react-query** for data fetching and network requests (`useQuery`, `useSuspenseQuery`, `useMutation`)
- Prefer `type` over `interface` when possible

## General Guidelines

- whenever handling amounts representing money, use `app/lib/money`
