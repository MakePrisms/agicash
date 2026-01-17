---
name: react-router-v7-expert
description: Use this skill when working with React Router v7 in this app. Covers filesystem-based routing with flatRoutes(), client-side data loading with clientLoader, auth-protected/public/auth route layouts, LinkWithViewTransition navigation, route middleware for auth guards, HydrateFallback patterns, and organizing routes by access level (_auth, _public, _protected). Use when adding new routes, implementing auth flows, configuring route loaders, or debugging routing issues.
license: MIT
source: https://github.com/raisiqueira/claude-code-plugins/tree/main/plugins/react-router-expert/.claude/skills/react-router-v7-expert
---

# React Router v7 Expert Skill

Expert guidance for React Router v7 in the context of the Agicash cryptocurrency wallet app.

## App Context

**Agicash** is a mobile-first cryptocurrency wallet (Bitcoin Lightning + Cashu eCash) built with:
- **Stack**: React 19 + React Router v7 (framework mode), Express SSR
- **Routing Strategy**: Filesystem-based routing with `flatRoutes()`
- **Organization**: Feature-based structure (app/features/*), route files in app/routes/
- **Data Loading**: Client-side with `clientLoader`, no server loaders
- **Navigation**: Custom `LinkWithViewTransition` for view transitions
- **Middleware**: Custom `unstable_clientMiddleware` for route guards

## App-Specific Routing Patterns

**Read these files to understand current patterns:**
1. **app/routes.ts** - Routing configuration (uses `flatRoutes()`)
2. **app/routes/** - Route file examples:
   - `_protected.tsx` - Protected layout with auth
   - `_protected._index.tsx` - Homepage (index route)
   - `_protected.transactions.$transactionId.details.tsx` - Dynamic param route
   - `_protected.verify-email.($code).tsx` - Optional param route
3. **app/lib/transitions.ts** - `LinkWithViewTransition` component

## Standards

When working with React Router in this app:
- Use generated types from `./+types/[routeName]`
- Follow filesystem-based routing conventions (underscore for layouts, dot for nesting, dollar for params)
- Use `clientLoader` (not `loader`) for data loading
- Use `LinkWithViewTransition` for navigation (not plain `Link`)
- Organize features in app/features/* with vertical slices
- Use `HydrateFallback` for loading states during hydration
- Keep route components thin, delegate to feature components

## React Router v7 Framework Mode

When providing solutions, follow these guidelines:

**THE MOST IMPORTANT RULE: ALWAYS use `./+types/[routeName]` for route type imports.**

```tsx
// ✅ CORRECT - ALWAYS use this pattern:
import type { Route } from "./+types/product-details";
import type { Route } from "./+types/product";
import type { Route } from "./+types/category";

// ❌ NEVER EVER use relative paths like this:
// import type { Route } from "../+types/product-details";  // WRONG!
// import type { Route } from "../../+types/product";       // WRONG!
```

**If you see TypeScript errors about missing `./+types/[routeName]` modules:**
1. **IMMEDIATELY run `typecheck`** to generate the types
2. **Or start the dev server** which will auto-generate types
3. **NEVER try to "fix" it by changing the import path**

## Critical Package Guidelines

### ✅ CORRECT Packages:
- `react-router` - Main package for routing components and hooks
- `@react-router/dev` - Development tools and route configuration
- `@react-router/node` - Node.js server adapter
- `@react-router/serve` - Production server

### ❌ NEVER Use:
- `react-router-dom` - Legacy package, use `react-router` instead
- `@remix-run/*` - Old packages, replaced by `@react-router/*`
- React Router v6 patterns - Completely different architecture

## Filesystem-Based Routing (App-Specific)

**This app uses `flatRoutes()` for filesystem-based routing.** Read `app/routes.ts` to see the configuration.

### File Naming Conventions (Currently Used)

**Read examples in:** `app/routes/`

- **Layout routes**: Prefix with underscore (`_protected.tsx`, `_public.tsx`, `_auth.tsx`)
- **Nested routes**: Use dots (`_protected.transactions.tsx`, `_protected.settings.profile.edit.tsx`)
- **Index routes**: End with `._index.tsx` (`_protected._index.tsx`, `_protected.transactions._index.tsx`)
- **Dynamic params**: Use dollar sign (`_protected.transactions.$transactionId.details.tsx`)
- **Optional params**: Use parentheses (`_protected.verify-email.($code).tsx`)

### Route Organization by Access Level

The app organizes routes into three access levels using layout routes:

**`_auth.*` - Authentication flows** (no auth required, redirects if logged in)
- Login, signup, forgot password, OAuth callbacks
- Examples: `_auth.login.tsx`, `_auth.signup.tsx`, `_auth.oauth.$provider.tsx`

**`_public.*` - Public pages** (no auth required, accessible to everyone)
- Marketing pages, legal pages, public token receiving
- Examples: `_public.home.tsx`, `_public.terms.tsx`, `_public.privacy.tsx`, `_public.receive-cashu-token.tsx`

**`_protected.*` - Protected wallet features** (auth required, redirects to login if not authenticated)
- Wallet homepage, send/receive money, transactions, settings
- Examples: `_protected._index.tsx`, `_protected.send.tsx`, `_protected.receive.tsx`, `_protected.transactions.tsx`, `_protected.settings.tsx`

Each layout route (`_auth.tsx`, `_public.tsx`, `_protected.tsx`) handles:
- Authentication checks and redirects
- Shared UI structure for child routes
- Context/state available to child routes

### Route Module Pattern (App-Specific)

**Key principles used in this app:**

1. **Always import types**: `import type { Route } from "./+types/[routeName]"`
   - If you get type errors, run `npm run typecheck` to generate types
   - Generated types provide: `ComponentProps`, `ClientLoaderArgs`, `ClientActionArgs`, etc.

2. **Use `clientLoader` for data loading** (not `loader`):
   - This app is client-side focused, no server loaders
   - Example: See `app/routes/_protected.verify-email.($code).tsx`
   - Use `clientLoader.hydrate = true` when needed

3. **Use `HydrateFallback` for loading states**:
   - Shown during hydration when `clientLoader.hydrate = true`
   - Example: `export function HydrateFallback() { return <LoadingScreen /> }`

4. **Keep route components thin**:
   - Delegate to feature components (e.g., `<TransactionAdditionalDetails />` from `~/features/transactions/`)
   - Route component handles params, feature component handles logic

5. **Use `LinkWithViewTransition` for navigation**:
   - Not plain `Link` from react-router
   - Read: `app/lib/transitions.ts` for implementation
   - Supports view transitions for smooth page changes

## Data Loading (App-Specific)

**This app uses client-side data loading only.** No server loaders.

### Client Loader Pattern

**Example:** See `app/routes/_protected.verify-email.($code).tsx`

```tsx
export async function clientLoader({ params, request, context }: Route.ClientLoaderArgs) {
  // Access params from route
  const { code } = params;

  // Access context from middleware
  const user = context.get(verifyEmailContext);

  // Perform client-side data fetching
  const result = await verifyEmail(code);

  // Can throw redirects
  if (result.verified) {
    throw getRedirectAwayFromVerifyEmail(request);
  }

  return { user };
}

// Force hydration - runs loader on initial page load
clientLoader.hydrate = true as const;

// Fallback component shown during hydration
export function HydrateFallback() {
  return <LoadingScreen />;
}
```

### Route Middleware (App-Specific)

**Example:** See `app/routes/_protected.verify-email.($code).tsx`

```tsx
export const unstable_clientMiddleware: Route.unstable_ClientMiddlewareFunction[] = [
  verifyEmailRouteGuard
];
```

Middleware can:
- Protect routes (auth checks)
- Inject context for loaders
- Redirect before rendering

### Form Handling

**Note:** Most form handling in this app uses React state and imperative APIs, not React Router `Form` components. Check existing routes in `app/routes/` for examples.

## Error Handling

**App default:** Errors bubble up to root-level `ErrorBoundary` in `app/root.tsx`.

Only add route-specific `ErrorBoundary` exports if the user explicitly requests it or if the route needs custom error UI.

```tsx
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // Handle route-specific errors
  return <div>Error: {error.message}</div>;
}
```

## Common Patterns

### Navigation

**Use `LinkWithViewTransition`** (not plain `Link`):
```tsx
import { LinkWithViewTransition } from '~/lib/transitions';

<LinkWithViewTransition to="/transactions" transition="slideLeft" applyTo="newView">
  Transactions
</LinkWithViewTransition>
```

### Accessing Route Data

**In components:**
```tsx
export default function MyRoute({ loaderData, params }: Route.ComponentProps) {
  // loaderData from clientLoader
  // params from URL
}
```

### Layout Routes with Outlets

**For layout routes** (like `_protected.tsx`), use `<Outlet />` to render child routes:
```tsx
import { Outlet } from 'react-router';

export default function ProtectedLayout() {
  return (
    <div>
      <Header />
      <Outlet /> {/* Child routes render here */}
    </div>
  );
}
```

## Anti-Patterns (Don't Use)

❌ **React Router v6 patterns** - `<Routes>`, `<Route>` JSX configuration (v7 uses file-based routing)
❌ **Manual data fetching in components** - Use `clientLoader` instead
❌ **Plain `Link` component** - Use `LinkWithViewTransition` in this app when it makes sense. Some custom use cases may require Link
❌ **Server loaders** (`loader`) - This app uses `clientLoader` only
❌ **Hardcoded paths** - Route types are generated, use them for type safety

## Quick Reference

**Key Files:**
- `app/routes.ts` - Routing configuration (flatRoutes)
- `app/routes/` - Route file examples
- `app/lib/transitions.ts` - LinkWithViewTransition component
- `app/features/` - Feature modules with business logic
- `app/root.tsx` - Root-level ErrorBoundary

**Route File Structure:**
```
app/routes/
├── _auth.tsx                               # Auth layout
├── _auth.login.tsx                         # Login page
├── _auth.signup.tsx                        # Signup page
├── _public.tsx                             # Public layout
├── _public.home.tsx                        # Landing page
├── _public.terms.tsx                       # Terms of service
├── _protected.tsx                          # Protected layout (auth required)
├── _protected._index.tsx                   # Wallet homepage
├── _protected.send.tsx                     # Send money
├── _protected.receive.tsx                  # Receive money
├── _protected.transactions._index.tsx      # Transactions list
├── _protected.transactions.$transactionId.details.tsx  # Transaction detail
└── _protected.verify-email.($code).tsx     # Optional param example
```

**Type Imports:**
```tsx
import type { Route } from "./+types/[routeName]";
// Provides: ComponentProps, ClientLoaderArgs, ClientActionArgs, etc.
```

**Common Exports:**
```tsx
export async function clientLoader() { }     // Data loading
export function HydrateFallback() { }        // Loading state
export function ErrorBoundary() { }          // Error UI
export const unstable_clientMiddleware = []  // Route guards
export default function Component() { }      // Route UI
```

## Resources

- [React Router v7 Docs](https://reactrouter.com/home)
- [Filesystem Routing Guide](https://reactrouter.com/start/framework/routing)
- App docs: See `CLAUDE.md` and `GUIDELINES.md`
