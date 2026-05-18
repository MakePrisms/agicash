# Migration from the React app

The agicash workspace was a React Router v7 / TanStack Query / Zustand /
TypeScript / Vite stack until the rust-first migration landed in merge
`ed3b4fb5` (Worker C, "chore: rust-primary repo migration — delete react app
+ devenv, own dev env via flake"). Everything under `app/`, `e2e/`,
`public/`, plus the React, Vercel, and devenv configs, is preserved on:

- Branch: `archive/react-web-app`
- Tag: `react-web-app-final`

To browse the pre-rust tree on demand:

```sh
git worktree add /tmp/react-ref archive/react-web-app
cd /tmp/react-ref
```

The Leptos PWA (`crates/agicash-web-leptos/`) is the rust replacement for
the React app on the browser side. It targets feature parity with the
pre-rust app, slice by slice; the slice plans live under
`docs/superpowers/plans/`.
