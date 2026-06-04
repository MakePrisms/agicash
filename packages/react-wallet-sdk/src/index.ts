/**
 * @agicash/react-wallet-sdk — React bindings for @agicash/wallet-sdk.
 *
 * Depends on React + Query<T> only — NO react-query / TanStack Query.
 * TanStack stays hidden inside @agicash/wallet-sdk; this package bridges
 * the framework-free Query<T> to React's useSyncExternalStore.
 */
export { AgicashProvider, useSdk } from './provider';
export { useQ } from './use-q';
export { useAccounts } from './hooks';
