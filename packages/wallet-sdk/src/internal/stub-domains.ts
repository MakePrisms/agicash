/**
 * Domain stubs — Slice 0.
 *
 * Each factory returns an object implementing its domain interface (§2-§10) where
 * every method throws {@link NotImplementedError} (or returns a rejected/throwing
 * Query for observable-fetch methods). The `Sdk` shell wires its domain accessors
 * to these so the public surface is fully present + type-correct, while the real
 * business logic lands in later slices (auth + user → S1 (DONE — real impls wired in
 * Sdk.create), accounts/scan → S2 (DONE — real impls wired in Sdk.create), cashu/spark → S3,
 * transactions/contacts/transfers → S4, background → S5). Swapping a stub for a real
 * impl is the unit of work for each slice.
 *
 * Implementing the interfaces (rather than casting) keeps the stubs honest: if a
 * contract method's signature changes, the stub fails to compile until updated.
 *
 * @module
 */
import type {
  BackgroundDomain,
  CashuDomain,
  ContactsDomain,
  ExchangeRateDomain,
  SparkDomain,
  TransactionsDomain,
  TransfersDomain,
} from '../domains';
import { NotImplementedError } from '../errors';
import type { Query } from '../types/query';

/** Helper: a method body that always throws a labelled {@link NotImplementedError}. */
const unimplemented = (method: string): never => {
  throw new NotImplementedError(method);
};

/**
 * Build a Query stub for observable-fetch methods: getSnapshot throws, subscribe
 * calls onError immediately, toPromise rejects, refetch rejects.
 */
// biome-ignore lint/suspicious/noExplicitAny: generic stub works for any T
function stubQuery<T = any>(method: string): Query<T> {
  return {
    getSnapshot: () => unimplemented(method),
    subscribe: (_onData, onError) => {
      const err = new NotImplementedError(method);
      onError?.(err);
      return () => {
        /* noop */
      };
    },
    toPromise: () => Promise.reject(new NotImplementedError(method)),
    refetch: () => Promise.reject(new NotImplementedError(method)),
  };
}

// NOTE: `AuthDomain` + `UserDomain` are REAL as of Slice 1 (see ../domains/auth +
// ../domains/user) and `AccountsDomain` + `ScanDomain` are REAL as of Slice 2 (see
// ../domains/accounts + ../domains/scan), all wired in Sdk.create — their stubs are removed.

/** Stub `CashuDomain` (`.send` + `.receive`; real impl: Slice 3). */
export const createCashuStub = (): CashuDomain => ({
  send: {
    createLightningQuote: () =>
      unimplemented('cashu.send.createLightningQuote'),
    createTokenQuote: () => unimplemented('cashu.send.createTokenQuote'),
    executeQuote: () => unimplemented('cashu.send.executeQuote'),
    failQuote: () => unimplemented('cashu.send.failQuote'),
    reverse: () => unimplemented('cashu.send.reverse'),
    get: () => stubQuery('cashu.send.get'),
  },
  receive: {
    receiveToken: () => unimplemented('cashu.receive.receiveToken'),
    createLightningQuote: () =>
      unimplemented('cashu.receive.createLightningQuote'),
    get: () => stubQuery('cashu.receive.get'),
  },
});

/** Stub `SparkDomain` (`.send` + `.receive`; real impl: Slice 3). */
export const createSparkStub = (): SparkDomain => ({
  send: {
    createLightningQuote: () =>
      unimplemented('spark.send.createLightningQuote'),
    executeQuote: () => unimplemented('spark.send.executeQuote'),
    failQuote: () => unimplemented('spark.send.failQuote'),
    get: () => stubQuery('spark.send.get'),
  },
  receive: {
    createLightningQuote: () =>
      unimplemented('spark.receive.createLightningQuote'),
    get: () => stubQuery('spark.receive.get'),
  },
});

/** Stub `TransactionsDomain` (real impl: Slice 4). */
export const createTransactionsStub = (): TransactionsDomain => ({
  list: () => stubQuery('transactions.list'),
  get: () => stubQuery('transactions.get'),
  countPendingAck: () => stubQuery('transactions.countPendingAck'),
  acknowledge: () => unimplemented('transactions.acknowledge'),
});

/** Stub `ContactsDomain` (real impl: Slice 4). */
export const createContactsStub = (): ContactsDomain => ({
  list: () => stubQuery('contacts.list'),
  get: () => stubQuery('contacts.get'),
  add: () => unimplemented('contacts.add'),
  remove: () => unimplemented('contacts.remove'),
  search: () => unimplemented('contacts.search'),
});

/** Stub `TransfersDomain` (real impl: Slice 4). */
export const createTransfersStub = (): TransfersDomain => ({
  createQuote: () => unimplemented('transfers.createQuote'),
  executeQuote: () => unimplemented('transfers.executeQuote'),
});

/** Stub `ExchangeRateDomain` (real impl: a later slice). */
export const createExchangeRateStub = (): ExchangeRateDomain => ({
  get: () => stubQuery('exchangeRate.get'),
});

/**
 * Stub `BackgroundDomain` (real impl: Slice 5). `state()` returns a Query stub —
 * real observers get `NotImplementedError` until the slice lands.
 */
export const createBackgroundStub = (): BackgroundDomain => ({
  start: () => unimplemented('background.start'),
  stop: () => unimplemented('background.stop'),
  state: () => stubQuery('background.state'),
});
