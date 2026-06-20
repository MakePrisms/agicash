import type { EngineContext, SdkEngine } from '../engine';
import type { User } from '../domains/user-types';
import {
  createEngineQueryClient,
  createMutationRunner,
} from '../internal/engine';
import { createFanout } from './fanout';
import { type StoreRegistry, createStoreRegistry } from './stores';
import { StoreWalletAccess } from './wallets';
import { createWorkSets } from './work-sets';

/** Variant-B engine: hidden query-core client, nine resident stores, a
 * MutationObserver-scope runner, store-read work sets, accounts-snapshot
 * WalletAccess, and a version-gated store-write fanout. Returns the SdkEngine
 * plus the captured `stores` (the entry needs them for the public Store reads
 * + the accounts surface). The base `sdk.ts` consumes only the 4 SdkEngine
 * fields and ignores the extra `stores` field. */
export function createStoreEngine(
  ctx: EngineContext,
  getUser: () => Promise<User | null>,
): SdkEngine & { stores: StoreRegistry } {
  const client = createEngineQueryClient();
  const stores = createStoreRegistry(ctx.runtime, client, getUser);
  return {
    runner: createMutationRunner(client),
    workSets: createWorkSets(stores),
    wallets: new StoreWalletAccess(stores.accounts, ctx.runtime),
    fanout: createFanout(stores),
    stores,
  };
}
