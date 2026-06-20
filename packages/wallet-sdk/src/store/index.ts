import type { Account } from '../domains/account-types';
import type { CashuReceiveQuote } from '../domains/cashu-receive-quote';
import type { CashuSendQuote } from '../domains/cashu-send-quote';
import type { Contact } from '../domains/contact';
import type { SparkReceiveQuote } from '../domains/spark-receive-quote';
import type { SparkSendQuote } from '../domains/spark-send-quote';
import type { User } from '../domains/user-types';
import type { CreateEngine } from '../engine';
import type { Store } from '../internal/engine';
import { Sdk } from '../sdk';
import { type StoreAccounts, createStoreAccounts } from './accounts-surface';
import { createStoreEngine } from './engine';
import type { StoreRegistry } from './stores';

export type { Store } from '../internal/engine';
export { createStoreEngine } from './engine';

/** Variant-B SDK: the hot reads are `Store<T>` views; everything else is base. */
export type StoreSdk = Omit<
  Sdk,
  'accounts' | 'user' | 'contacts' | 'cashu' | 'spark'
> & {
  accounts: StoreAccounts;
  user: Sdk['user'] & { current: Store<User | null> };
  contacts: Sdk['contacts'] & { all: Store<Contact[]> };
  cashu: {
    send: Sdk['cashu']['send'] & { unresolved: Store<CashuSendQuote[]> };
    receive: Sdk['cashu']['receive'] & { pending: Store<CashuReceiveQuote[]> };
  };
  spark: {
    send: Sdk['spark']['send'] & { unresolved: Store<SparkSendQuote[]> };
    receive: Sdk['spark']['receive'] & { pending: Store<SparkReceiveQuote[]> };
  };
};

export async function createStoreSdk(
  config: Parameters<typeof Sdk.create>[0],
  deps?: Omit<NonNullable<Parameters<typeof Sdk.create>[1]>, 'createEngine'>,
): Promise<StoreSdk> {
  // getUser is injected into the engine via this closure. createEngine runs
  // synchronously inside Sdk.create (before `sdk` exists), and the store
  // mount-fetches fire during createEngine. getUser awaits `sdkReady`, so those
  // mount-fetches stay pending until Sdk.create resolves and then read the REAL
  // user — no placeholder value is ever served. A store can only be `undefined`
  // (loading) or the real value, never a stale seed.
  let resolveSdk!: (sdk: Sdk) => void;
  let rejectSdk!: (err: unknown) => void;
  const sdkReady = new Promise<Sdk>((res, rej) => {
    resolveSdk = res;
    rejectSdk = rej;
  });
  // Swallow the settle on the error path: the real store consumers await via
  // toPromise() and surface their own rejections, so nothing else awaits
  // sdkReady directly — without this a rejectSdk would be an unhandled rejection.
  sdkReady.catch(() => {});
  const getUser: () => Promise<User | null> = async () =>
    (await sdkReady).user.get();
  let stores: StoreRegistry | undefined;
  const createEngine: CreateEngine = (ctx) => {
    const engine = createStoreEngine(ctx, getUser);
    stores = engine.stores;
    return engine;
  };
  let sdk: Sdk;
  try {
    sdk = await Sdk.create(config, { ...deps, createEngine });
  } catch (err) {
    rejectSdk(err);
    throw err;
  }
  resolveSdk(sdk);
  if (!stores) throw new Error('store engine did not initialise stores');

  // Augment the domains with the public Store hot reads + the accounts surface.
  const accounts = createStoreAccounts({
    base: sdk.accounts,
    accountsStore: stores.accounts,
    getUser,
  });
  Object.defineProperty(sdk, 'accounts', {
    value: accounts,
    writable: false,
    configurable: true,
  });
  Object.defineProperty(sdk.user, 'current', {
    value: stores.user,
    configurable: true,
  });
  Object.defineProperty(sdk.contacts, 'all', {
    value: stores.contacts,
    configurable: true,
  });
  Object.defineProperty(sdk.cashu.send, 'unresolved', {
    value: stores.cashuSendQuotes,
    configurable: true,
  });
  Object.defineProperty(sdk.cashu.receive, 'pending', {
    value: stores.cashuReceiveQuotes,
    configurable: true,
  });
  Object.defineProperty(sdk.spark.send, 'unresolved', {
    value: stores.sparkSendQuotes,
    configurable: true,
  });
  Object.defineProperty(sdk.spark.receive, 'pending', {
    value: stores.sparkReceiveQuotes,
    configurable: true,
  });

  return sdk as unknown as StoreSdk;
}
