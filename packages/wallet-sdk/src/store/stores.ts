import type { Account } from '../domains/account-types';
import type { CashuReceiveQuote } from '../domains/cashu-receive-quote';
import type { CashuReceiveSwap } from '../domains/cashu-receive-swap';
import type { CashuSendQuote } from '../domains/cashu-send-quote';
import type { CashuSendSwap } from '../domains/cashu-send-swap';
import type { Contact } from '../domains/contact';
import type { SparkReceiveQuote } from '../domains/spark-receive-quote';
import type { SparkSendQuote } from '../domains/spark-send-quote';
import type { User } from '../domains/user-types';
import type { WalletRuntime } from '../internal/wallet-runtime';
import { type QueryClient, type Store, createStore } from '../internal/engine';

export type StoreRegistry = {
  user: Store<User | null>;
  accounts: Store<Account[]>;
  contacts: Store<Contact[]>;
  cashuSendQuotes: Store<CashuSendQuote[]>;
  cashuSendSwaps: Store<CashuSendSwap[]>;
  sparkSendQuotes: Store<SparkSendQuote[]>;
  cashuReceiveQuotes: Store<CashuReceiveQuote[]>;
  cashuReceiveSwaps: Store<CashuReceiveSwap[]>;
  sparkReceiveQuotes: Store<SparkReceiveQuote[]>;
};

export const STORE_KEYS = {
  user: ['store', 'user'] as const,
  accounts: ['store', 'accounts'] as const,
  contacts: ['store', 'contacts'] as const,
  cashuSendQuotes: ['store', 'cashu-send-quotes'] as const,
  cashuSendSwaps: ['store', 'cashu-send-swaps'] as const,
  sparkSendQuotes: ['store', 'spark-send-quotes'] as const,
  cashuReceiveQuotes: ['store', 'cashu-receive-quotes'] as const,
  cashuReceiveSwaps: ['store', 'cashu-receive-swaps'] as const,
  sparkReceiveQuotes: ['store', 'spark-receive-quotes'] as const,
};

/**
 * The nine resident Variant-B stores. Each list store's parameterless seed
 * resolves the current userId from `getUser` (injected by `createStoreSdk`)
 * and reads its repo; signed-out → empty without a repo call. `staleTime: Infinity`
 * (client default) means the fanout's version-gated writes own freshness after seed.
 */
export function createStoreRegistry(
  runtime: WalletRuntime,
  client: QueryClient,
  getUser: () => Promise<User | null>,
): StoreRegistry {
  const p = runtime.protocols;

  const listFor = <T>(
    key: readonly unknown[],
    read: (userId: string) => Promise<T[]>,
  ) =>
    createStore<T[]>(client, [...key], async () => {
      const id = (await getUser())?.id;
      return id ? read(id) : [];
    });

  return {
    user: createStore<User | null>(client, [...STORE_KEYS.user], () =>
      getUser(),
    ),
    accounts: listFor(STORE_KEYS.accounts, (id) =>
      runtime.accountRepository.getAllActive(id),
    ),
    contacts: listFor(STORE_KEYS.contacts, (id) =>
      p.contactRepository.getAll(id),
    ),
    cashuSendQuotes: listFor(STORE_KEYS.cashuSendQuotes, (id) =>
      p.cashuSendQuoteRepository.getUnresolved(id),
    ),
    cashuSendSwaps: listFor(STORE_KEYS.cashuSendSwaps, (id) =>
      p.cashuSendSwapRepository.getUnresolved(id),
    ),
    sparkSendQuotes: listFor(STORE_KEYS.sparkSendQuotes, (id) =>
      p.sparkSendQuoteRepository.getUnresolved(id),
    ),
    cashuReceiveQuotes: listFor(STORE_KEYS.cashuReceiveQuotes, (id) =>
      p.cashuReceiveQuoteRepository.getPending(id),
    ),
    cashuReceiveSwaps: listFor(STORE_KEYS.cashuReceiveSwaps, (id) =>
      p.cashuReceiveSwapRepository.getPending(id),
    ),
    sparkReceiveQuotes: listFor(STORE_KEYS.sparkReceiveQuotes, (id) =>
      p.sparkReceiveQuoteRepository.getPending(id),
    ),
  };
}

export function allStores(reg: StoreRegistry): Store<unknown>[] {
  return Object.values(reg) as Store<unknown>[];
}
