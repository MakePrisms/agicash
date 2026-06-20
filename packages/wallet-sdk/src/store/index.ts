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
  // synchronously inside Sdk.create (before `sdk` exists); the placeholder is
  // replaced before any store is fetched (seeding/first read happen after create).
  let getUser: () => Promise<User | null> = async () => null;
  let stores: StoreRegistry | undefined;
  const createEngine: CreateEngine = (ctx) => {
    const engine = createStoreEngine(ctx, () => getUser());
    stores = engine.stores;
    return engine;
  };
  const sdk = await Sdk.create(config, { ...deps, createEngine });
  if (!stores) throw new Error('store engine did not initialise stores');
  getUser = () => sdk.user.get();

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
