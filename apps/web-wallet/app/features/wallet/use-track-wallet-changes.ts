/**
 * No-op. Variant B realtime liveness is owned by the SDK's change feed and core
 * lifecycle events; the app no longer wires per-table change handlers into a
 * broadcast channel. This now-empty hook is retained only so `wallet.tsx` keeps
 * compiling; BW-T13 removes the call site and deletes this file.
 */
export const useTrackWalletChanges = () => {};
