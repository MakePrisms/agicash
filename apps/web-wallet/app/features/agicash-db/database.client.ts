import { getAgicashDb } from '@agicash/wallet-sdk/agicash-db';
import { getSdk } from '../shared/sdk';

/**
 * The web's client-side handle to the SDK-owned Supabase database instance,
 * for web-owned features (feature flags, the task-processing lock). If you
 * need a client on the server, which bypasses RLS, use `agicashDbServer`
 * instead.
 */
export const agicashDbClient = getAgicashDb();

// Debug handle for the SDK-owned realtime manager.
// biome-ignore lint/suspicious/noExplicitAny: attaching to window for debugging
(window as any).agicashRealtime = getSdk().realtime.__debugManager;
