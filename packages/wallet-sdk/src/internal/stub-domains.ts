/**
 * Domain stubs — Slice 0.
 *
 * Each factory returns an object implementing its domain interface (§2-§10) where
 * every method throws {@link NotImplementedError}. The `Sdk` shell wires its domain
 * accessors to these so the public surface is fully present + type-correct, while the
 * real business logic lands in later slices (auth/user → S1 (DONE), accounts/scan → S2 (DONE),
 * cashu/spark → S3 (DONE), transactions/contacts/transfers → S4 (DONE), background → S5).
 * Swapping a stub for a real impl is the unit of work for each slice — these are the seams.
 *
 * Implementing the interfaces (rather than casting) keeps the stubs honest: if a
 * contract method's signature changes, the stub fails to compile until updated.
 *
 * @module
 */
import type {
  BackgroundDomain,
  CashuDomain,
  ExchangeRateDomain,
  SparkDomain,
} from '../domains';
import { NotImplementedError } from '../errors';
import type { BackgroundState } from '../events';

/** Helper: a method body that always rejects with a labelled {@link NotImplementedError}. */
const unimplemented = (method: string): never => {
  throw new NotImplementedError(method);
};

/**
 * Stub factories for the domains not yet implemented. `auth` + `user` (Slice 1) and
 * `accounts` + `scan` (Slice 2) are no longer stubbed — they are real (`../domains/*`),
 * wired directly in `Sdk.create`.
 */

/** Stub `CashuDomain` (`.send` + `.receive`; real impl: Slice 3). */
export const createCashuStub = (): CashuDomain => ({
  send: {
    createLightningQuote: () =>
      unimplemented('cashu.send.createLightningQuote'),
    createTokenQuote: () => unimplemented('cashu.send.createTokenQuote'),
    executeQuote: () => unimplemented('cashu.send.executeQuote'),
    failQuote: () => unimplemented('cashu.send.failQuote'),
    reverse: () => unimplemented('cashu.send.reverse'),
    get: () => unimplemented('cashu.send.get'),
  },
  receive: {
    receiveToken: () => unimplemented('cashu.receive.receiveToken'),
    createLightningQuote: () =>
      unimplemented('cashu.receive.createLightningQuote'),
    get: () => unimplemented('cashu.receive.get'),
  },
});

/** Stub `SparkDomain` (`.send` + `.receive`; real impl: Slice 3). */
export const createSparkStub = (): SparkDomain => ({
  send: {
    createLightningQuote: () =>
      unimplemented('spark.send.createLightningQuote'),
    executeQuote: () => unimplemented('spark.send.executeQuote'),
    failQuote: () => unimplemented('spark.send.failQuote'),
    get: () => unimplemented('spark.send.get'),
  },
  receive: {
    createLightningQuote: () =>
      unimplemented('spark.receive.createLightningQuote'),
    get: () => unimplemented('spark.receive.get'),
  },
});

/** Stub `ExchangeRateDomain` (real impl: a later slice). */
export const createExchangeRateStub = (): ExchangeRateDomain => ({
  convert: () => unimplemented('exchangeRate.convert'),
});

/**
 * Stub `BackgroundDomain` (real impl: Slice 5). `state()` is synchronous and must
 * return a {@link BackgroundState}; the stub reports `'stopped'` (the pre-start state)
 * rather than throwing, so consumers can poll it harmlessly before Slice 5 lands.
 * `start` / `stop` still throw — actually driving the processor is Slice 5's job.
 */
export const createBackgroundStub = (): BackgroundDomain => ({
  start: () => unimplemented('background.start'),
  stop: () => unimplemented('background.stop'),
  state: (): BackgroundState => 'stopped',
});
