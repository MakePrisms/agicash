import type { CreateEngine, EngineContext, SdkEngine } from '../engine';
import type { EventBus } from '../internal/event-bus';
import { createFanout } from './fanout';
import type { SdkEventMapA } from './event-map';
import { KeyedQueue } from './keyed-queue';
import { ResidentAccounts } from './resident-accounts';
import { createWorkSets } from './work-sets';

/**
 * Variant A's engine: an in-memory KeyedQueue runner, DB-on-demand work-sets, a
 * resident account map, and a row-event fanout on the (widened) shared bus.
 */
export const createStatelessEngine: CreateEngine = (
  ctx: EngineContext,
): SdkEngine => {
  const accounts = new ResidentAccounts(ctx.runtime);
  // The bus instance is shared with sdk.on; widen the type so the fanout can
  // emit Variant-A row events on it.
  const bus = ctx.events as unknown as EventBus<SdkEventMapA>;
  return {
    runner: new KeyedQueue(),
    workSets: createWorkSets(ctx.runtime, accounts),
    wallets: accounts,
    fanout: createFanout(bus, accounts),
  };
};
