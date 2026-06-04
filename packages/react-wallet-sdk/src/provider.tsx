import type { Sdk } from '@agicash/wallet-sdk';
/**
 * AgicashProvider + useSdk — React context wiring for the Sdk instance.
 *
 * Consumers wrap their tree in <AgicashProvider sdk={sdk}> and retrieve the
 * instance anywhere below via useSdk(). Standard React context pattern —
 * no magic, no extra dependencies.
 */
import { type ReactNode, createContext, useContext } from 'react';

// biome-ignore lint/style/noNonNullAssertion: standard React context pattern — null is the "no provider" sentinel; useSdk throws before the caller can reach a null Sdk
const Ctx = createContext<Sdk>(null!);

/**
 * Provides the Sdk instance to the React subtree.
 *
 * @param sdk - the initialised Sdk (from `await Sdk.create(config)`).
 * @param children - the React subtree.
 */
export function AgicashProvider({
  sdk,
  children,
}: {
  sdk: Sdk;
  children: ReactNode;
}) {
  return <Ctx.Provider value={sdk}>{children}</Ctx.Provider>;
}

/**
 * Returns the Sdk instance from the nearest AgicashProvider.
 * Throws if called outside of AgicashProvider.
 */
export function useSdk(): Sdk {
  return useContext(Ctx);
}
