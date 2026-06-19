import type { CreateEngine } from '../engine';
import { Sdk } from '../sdk';
import {
  createStatelessAccounts,
  type StatelessAccounts,
} from './accounts-surface';
import { createStatelessEngine } from './engine';
import type { SdkEventMapA } from './event-map';
import type { ResidentAccounts } from './resident-accounts';

export { createStatelessEngine } from './engine';
export type { SdkEventMapA } from './event-map';
export { createStatelessAccounts } from './accounts-surface';
export type { StatelessAccounts } from './accounts-surface';

type CreateConfig = Parameters<typeof Sdk.create>[0];
/** The injectable deps, minus `createEngine` (the entry supplies the A engine). */
type CreateDeps = Omit<
  NonNullable<Parameters<typeof Sdk.create>[1]>,
  'createEngine'
>;

/**
 * An Sdk whose `on` is typed to the widened Variant-A event map and whose
 * `accounts` carries Variant A's resident `list()` + first-of-currency
 * `getDefault` fallback.
 */
export type StatelessSdk = Omit<Sdk, 'on' | 'accounts'> & {
  on<E extends keyof SdkEventMapA>(
    event: E,
    cb: (payload: SdkEventMapA[E]) => void,
  ): () => void;
  accounts: StatelessAccounts;
};

/**
 * Variant A client entry: constructs the Sdk with the stateless engine, captures
 * the engine's `ResidentAccounts` via a wrapping `createEngine` closure (which
 * runs synchronously inside `Sdk.create`), and overrides `sdk.accounts` with the
 * resident-backed `StatelessAccounts`. The runtime bus is the same instance the
 * engine's fanout emits row events on, so subscribing to A-only events works.
 */
export async function createStatelessSdk(
  config: CreateConfig,
  deps?: CreateDeps,
): Promise<StatelessSdk> {
  let resident: ResidentAccounts | undefined;
  const createEngine: CreateEngine = (ctx) => {
    const engine = createStatelessEngine(ctx);
    resident = engine.wallets as ResidentAccounts;
    return engine;
  };

  const sdk = await Sdk.create(config, { ...deps, createEngine });
  if (!resident) {
    throw new Error('stateless engine did not initialise resident accounts');
  }

  const accounts = createStatelessAccounts({
    base: sdk.accounts,
    accounts: resident,
    getUser: () => sdk.user.get(),
  });
  Object.defineProperty(sdk, 'accounts', {
    value: accounts,
    writable: false,
    configurable: true,
  });

  return sdk as unknown as StatelessSdk;
}
