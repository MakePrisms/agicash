import { Sdk } from '../sdk';
import { createStatelessEngine } from './engine';
import type { SdkEventMapA } from './event-map';

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

/** An Sdk whose `on` is typed to the widened Variant-A event map. */
export type StatelessSdk = Omit<Sdk, 'on'> & {
  on<E extends keyof SdkEventMapA>(
    event: E,
    cb: (payload: SdkEventMapA[E]) => void,
  ): () => void;
};

/**
 * Variant A client entry: constructs the Sdk with the stateless engine and
 * re-types `sdk.on` to SdkEventMapA. The runtime bus is the same instance the
 * engine's fanout emits row events on, so subscribing to A-only events works.
 */
export async function createStatelessSdk(
  config: CreateConfig,
  deps?: CreateDeps,
): Promise<StatelessSdk> {
  const sdk = await Sdk.create(config, {
    ...deps,
    createEngine: createStatelessEngine,
  });
  return sdk as unknown as StatelessSdk;
}
