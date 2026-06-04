import { AgicashProvider } from '@agicash/react-wallet-sdk';
import { isServer } from '@tanstack/react-query';
import { type ReactNode, use } from 'react';
import { getSdk } from './sdk';

/**
 * Mounts {@link AgicashProvider} with the browser `Sdk` singleton (PR8a).
 *
 * The `Sdk` is browser-only and `Sdk.create` is async, while the app root (`root.tsx`) is
 * sync and also runs during SSR. So:
 * - On the server we render `children` directly (no provider). The SDK context default is the
 *   "no provider" sentinel; nothing reads the SDK in PR8a, and a context provider emits no DOM,
 *   so the server and client trees hydrate identically.
 * - On the client we unwrap the memoised `getSdk()` promise with React's `use`. `Sdk.create`
 *   opens no network connections and does no I/O (constructors only), so the promise settles in
 *   a microtask — `use` resolves before paint and does not block the app.
 */
export function SdkProvider({ children }: { children: ReactNode }) {
  if (isServer) {
    return <>{children}</>;
  }
  return <ClientSdkProvider>{children}</ClientSdkProvider>;
}

function ClientSdkProvider({ children }: { children: ReactNode }) {
  const sdk = use(getSdk());
  return <AgicashProvider sdk={sdk}>{children}</AgicashProvider>;
}
