/**
 * Domain stubs — Slice 0.
 *
 * Each factory returns an object implementing its domain interface (§2-§10) where
 * every method throws {@link NotImplementedError}. The `Sdk` shell wires its domain
 * accessors to these so the public surface is fully present + type-correct in PR2,
 * while the real business logic lands in later slices (auth → S1, accounts/scan → S2,
 * cashu/spark → S3, transactions/contacts/transfers → S4, background → S5). Swapping a
 * stub for a real impl is the unit of work for each slice — these are the seams.
 *
 * Implementing the interfaces (rather than casting) keeps the stubs honest: if a
 * contract method's signature changes, the stub fails to compile until updated.
 *
 * @module
 */
import type {
  AccountsDomain,
  AuthDomain,
  BackgroundDomain,
  CashuDomain,
  ContactsDomain,
  ExchangeRateDomain,
  ScanDomain,
  SparkDomain,
  TransactionsDomain,
  TransfersDomain,
  UserDomain,
} from '../domains';
import { NotImplementedError } from '../errors';
import type { BackgroundState } from '../events';

/** Helper: a method body that always rejects with a labelled {@link NotImplementedError}. */
const unimplemented = (method: string): never => {
  throw new NotImplementedError(method);
};

/** Stub `AuthDomain` (real impl: Slice 1). */
export const createAuthStub = (): AuthDomain => ({
  signIn: () => unimplemented('auth.signIn'),
  signUp: () => unimplemented('auth.signUp'),
  signInGuest: () => unimplemented('auth.signInGuest'),
  signOut: () => unimplemented('auth.signOut'),
  refresh: () => unimplemented('auth.refresh'),
  resetPassword: () => unimplemented('auth.resetPassword'),
  changePassword: () => unimplemented('auth.changePassword'),
  upgradeGuest: () => unimplemented('auth.upgradeGuest'),
  beginGoogleSignIn: () => unimplemented('auth.beginGoogleSignIn'),
  completeOAuth: () => unimplemented('auth.completeOAuth'),
});

/** Stub `UserDomain` (real impl: Slice 1). */
export const createUserStub = (): UserDomain => ({
  getCurrentUser: () => unimplemented('user.getCurrentUser'),
  updateUsername: () => unimplemented('user.updateUsername'),
});

/** Stub `AccountsDomain` (real impl: Slice 2). */
export const createAccountsStub = (): AccountsDomain => ({
  list: () => unimplemented('accounts.list'),
  get: () => unimplemented('accounts.get'),
  getDefault: () => unimplemented('accounts.getDefault'),
  add: () => unimplemented('accounts.add'),
  setDefault: () => unimplemented('accounts.setDefault'),
  getBalance: () => unimplemented('accounts.getBalance'),
  suggestFor: () => unimplemented('accounts.suggestFor'),
});

/** Stub `ScanDomain` (real impl: Slice 2). */
export const createScanStub = (): ScanDomain => ({
  parse: () => unimplemented('scan.parse'),
});

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

/** Stub `TransactionsDomain` (real impl: Slice 4). */
export const createTransactionsStub = (): TransactionsDomain => ({
  list: () => unimplemented('transactions.list'),
  get: () => unimplemented('transactions.get'),
  countPendingAck: () => unimplemented('transactions.countPendingAck'),
  acknowledge: () => unimplemented('transactions.acknowledge'),
});

/** Stub `ContactsDomain` (real impl: Slice 4). */
export const createContactsStub = (): ContactsDomain => ({
  list: () => unimplemented('contacts.list'),
  get: () => unimplemented('contacts.get'),
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
