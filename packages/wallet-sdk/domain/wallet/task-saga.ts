import type { Currency } from '@agicash/money';
import type { RunScope } from '../../lib/run-scope';
import type { Account, CashuAccount, SparkAccount } from '../accounts/account';
import type {
  ActivityMonitor,
  Logger,
  WalletEventMap,
  WalletEvents,
} from '../sdk';
import type { WalletEventMessage } from './realtime-broadcasts';

/** The emitter surface the sagas use: subscribe, and emit contract events. */
export type SagaEventBus = {
  on: WalletEvents['on'];
  emit(message: WalletEventMessage): void;
};

/** One leadership stint, as a saga sees it. Everything it hands out dies with `scope`. */
export type SagaStint = {
  readonly scope: RunScope;
  readonly userId: string;
  readonly activity: ActivityMonitor;
  readonly accounts: StintAccounts;
  readonly queue: KeyedSerialQueue;
  readonly logger: Logger;
  now(): number;
  /** Subscribes for the rest of the stint. */
  on<K extends keyof WalletEventMap>(
    event: K,
    handler: (payload: WalletEventMap[K]) => void,
  ): void;
  /** Emits a contract event (hosts receive it too). A no-op once the stint is dead. */
  emit(message: WalletEventMessage): void;
  /** Runs `handler` on every inactive → active change during the stint. */
  onActivated(handler: () => void): void;
  /** Runs `handler` on every `connection.changed: 'connected'` after the stint began; not on the subscribe-time replay. */
  onReconnected(handler: () => void): void;
};

/** A flow's task processing. Registered SDK-internally; never public. */
export type TaskSaga = {
  readonly name: string;
  /** Starts the flow for one stint. Synchronous; every promise it starts is tracked on `stint.scope`. */
  start(stint: SagaStint): void;
};

/** The user's active accounts for one stint. Loaded on first use. */
export type StintAccounts = {
  /** All active accounts. One `getAllActive` per stint, again after `markStale()`. */
  getAll(): Promise<Account[]>;
  /** The account, or undefined when it is not active. */
  get(id: string): Promise<Account | undefined>;
  /** Like `get`, but throws `Account not found for id: ${id}` or `Account with id: ${id} is not of type: ${type}`. */
  getCashu(id: string): Promise<CashuAccount>;
  getSpark(id: string): Promise<SparkAccount>;
  /** The active Cashu account for the mint URL and currency, or undefined. */
  findCashu(
    mintUrl: string,
    currency: Currency,
  ): Promise<CashuAccount | undefined>;
  /** Replaces the account when `account.version` is newer; adds an unknown id. */
  apply(account: Account): void;
  /** The next read reloads. */
  markStale(): void;
};

export type WorkingSet<T> = {
  get(key: string): T | undefined;
  values(): T[];
  /** The first item matching `predicate`, or undefined. */
  find(predicate: (item: T) => boolean): T | undefined;
  /** Applies an event or an action result. Version-gated; drops items that are no longer pending. */
  apply(item: T): void;
};

/** FIFO per key, distinct keys concurrent. */
export type KeyedSerialQueue = {
  /**
   * Runs `job` after every job enqueued earlier under `key` has settled.
   * Every call runs `job` exactly once, unless `scope` is dead when its turn
   * comes; then it is skipped. `key` undefined runs at once (an unscoped
   * mutation). The run is tracked on `scope`.
   */
  enqueue(
    key: string | undefined,
    scope: RunScope,
    job: () => Promise<void>,
  ): void;
};

/** TanStack's `retry`: a retry count, or a predicate over (failures so far, error). */
export type RetryPolicy =
  | number
  | ((failureCount: number, error: unknown) => boolean);

export type ActionOutcome<T> =
  | { status: 'succeeded'; value: T }
  | { status: 'failed'; error: unknown }
  | { status: 'abandoned' };

export const RETRY_MAX_DELAY_MS = 30_000;

/** How often a saga retries items it gave up on while the host stays active. */
export const GIVE_UP_RETRY_MS = 60_000;

export type SagaAction<T> = {
  /** The serial-queue key; undefined runs the action at once. */
  key: string | undefined;
  retry: RetryPolicy;
  /** One attempt. Re-reads its guard from the working set; returns undefined when the guard fails. */
  attempt: () => Promise<T | undefined>;
  onSuccess?: (value: T) => void;
  /** Called on `failed`: the log line, plus any follow-up action. */
  onError: (error: unknown) => void;
  /**
   * Called after `onError` on `failed`, and alone on `abandoned`, only while
   * the stint scope is alive. The saga re-arms the item for the next reload.
   */
  onGiveUp?: () => void;
};

type Held<T> = {
  item: T;
  seq: number;
};

type Tombstone = {
  version: number;
};

/**
 * Builds the handle one saga sees for a single leadership stint.
 * Subscriptions and the account set die with `deps.scope`.
 */
export function createSagaStint(deps: {
  scope: RunScope;
  userId: string;
  events: SagaEventBus;
  activity: ActivityMonitor;
  loadAccounts: (userId: string, signal: AbortSignal) => Promise<Account[]>;
  queue: KeyedSerialQueue;
  logger: Logger;
  now: () => number;
}): SagaStint {
  const activationHandlers: Array<() => void> = [];
  let lastActive = deps.activity.isActive();
  const unsubscribeActivity = deps.activity.subscribe(() => {
    const active = deps.activity.isActive();
    const becameActive = !lastActive && active;
    lastActive = active;
    if (!becameActive) {
      return;
    }
    for (const handler of [...activationHandlers]) {
      handler();
    }
  });
  deps.scope.onCleanup(unsubscribeActivity);

  const reconnectHandlers: Array<() => void> = [];
  let subscribing = true;
  const unsubscribeConnection = deps.events.on(
    'connection.changed',
    (payload) => {
      if (subscribing) {
        return;
      }
      if (payload.state !== 'connected') {
        return;
      }
      for (const handler of [...reconnectHandlers]) {
        handler();
      }
    },
  );
  subscribing = false;
  deps.scope.onCleanup(unsubscribeConnection);

  const accounts = createStintAccounts({
    userId: deps.userId,
    scope: deps.scope,
    loadAccounts: deps.loadAccounts,
  });

  const stint: SagaStint = {
    scope: deps.scope,
    userId: deps.userId,
    activity: deps.activity,
    accounts,
    queue: deps.queue,
    logger: deps.logger,
    now: () => deps.now(),
    on(event, handler) {
      const unsubscribe = deps.events.on(event, handler);
      deps.scope.onCleanup(unsubscribe);
    },
    emit(message) {
      if (!deps.scope.alive) {
        return;
      }
      deps.events.emit(message);
    },
    onActivated(handler) {
      activationHandlers.push(handler);
    },
    onReconnected(handler) {
      reconnectHandlers.push(handler);
    },
  };

  stint.on('account.created', ({ account }) => {
    accounts.apply(account);
  });
  stint.on('account.updated', ({ account }) => {
    accounts.apply(account);
  });
  stint.onReconnected(() => {
    accounts.markStale();
  });

  return stint;
}

/**
 * The per-flow pending set for one stint: an initial load, reloads on
 * activation and reconnect, and version-gated `apply`.
 */
export function startWorkingSet<T extends { version: number }>(
  stint: SagaStint,
  options: {
    name: string;
    keyOf: (item: T) => string;
    isPending: (item: T) => boolean;
    load: (signal: AbortSignal) => Promise<T[]>;
    /** Runs after every change (load, event, action result). */
    onChange: () => void;
  },
): WorkingSet<T> {
  let items = new Map<string, Held<T>>();
  const tombstones = new Map<string, Tombstone>();
  let seq = 0;
  let loading = false;
  let again = false;

  const nextSeq = (): number => {
    seq += 1;
    return seq;
  };

  const reconcile = (loaded: T[], startedAt: number): void => {
    const next = new Map<string, Held<T>>();
    for (const item of loaded) {
      const key = options.keyOf(item);
      const tomb = tombstones.get(key);
      if (tomb && tomb.version >= item.version) {
        continue;
      }
      const held = items.get(key);
      if (
        held &&
        (held.item.version > item.version ||
          (held.item.version === item.version && held.seq > startedAt))
      ) {
        next.set(key, held);
        continue;
      }
      if (!options.isPending(item)) {
        continue;
      }
      next.set(key, { item, seq: startedAt });
    }
    for (const [key, held] of items) {
      if (next.has(key) || held.seq <= startedAt) {
        continue;
      }
      const tomb = tombstones.get(key);
      if (tomb && tomb.version >= held.item.version) {
        continue;
      }
      if (!options.isPending(held.item)) {
        continue;
      }
      next.set(key, held);
      again = true;
    }
    items = next;
  };

  const runLoad = (): void => {
    if (!stint.scope.alive) {
      return;
    }
    if (loading) {
      again = true;
      return;
    }
    loading = true;
    again = false;
    const startedAt = seq;
    void (async () => {
      const outcome = await runWithRetry(
        stint,
        () => options.load(stint.scope.signal),
        3,
      );
      if (!stint.scope.alive) {
        loading = false;
        return;
      }
      loading = false;
      if (outcome.status === 'succeeded') {
        reconcile(outcome.value, startedAt);
        options.onChange();
      } else if (outcome.status === 'failed') {
        stint.logger.warn('Failed to load pending tasks', {
          saga: options.name,
          cause: outcome.error,
        });
      }
      if (again && stint.scope.alive) {
        runLoad();
      }
    })();
  };

  stint.onActivated(() => {
    runLoad();
  });
  stint.onReconnected(() => {
    runLoad();
  });
  runLoad();

  return {
    get(key) {
      return items.get(key)?.item;
    },
    values() {
      return [...items.values()].map((entry) => entry.item);
    },
    find(predicate) {
      for (const entry of items.values()) {
        if (predicate(entry.item)) {
          return entry.item;
        }
      }
      return undefined;
    },
    apply(item) {
      if (!stint.scope.alive) {
        return;
      }
      const key = options.keyOf(item);
      const tomb = tombstones.get(key);
      if (tomb && item.version <= tomb.version) {
        return;
      }
      const held = items.get(key);
      if (held && item.version <= held.item.version) {
        return;
      }
      const stamped = nextSeq();
      if (!options.isPending(item)) {
        items.delete(key);
        tombstones.set(key, { version: item.version });
        options.onChange();
        return;
      }
      items.set(key, { item, seq: stamped });
      options.onChange();
    },
  };
}

/** FIFO per key. One queue outlives leadership stints; each job is fenced by its own scope. */
export function createKeyedSerialQueue(): KeyedSerialQueue {
  const tails = new Map<string, Promise<void>>();

  return {
    enqueue(key, scope, job) {
      const execute = async (): Promise<void> => {
        if (!scope.alive) {
          return;
        }
        await job();
      };
      const previous = key === undefined ? undefined : tails.get(key);
      const run = previous ? previous.then(execute) : execute();
      const settled = run.then(
        () => undefined,
        () => undefined,
      );
      if (key !== undefined) {
        tails.set(key, settled);
        void settled.then(() => {
          if (tails.get(key) === settled) {
            tails.delete(key);
          }
        });
      }
      scope.track(settled);
    },
  };
}

/**
 * Runs `attempt` with TanStack mutation retry semantics: a retry n+1 waits
 * `min(1000 * 2 ** n, 30_000)` ms. Abandons (never rejects) when the scope dies
 * or when the host is inactive after a backoff; the next trigger starts afresh.
 */
export async function runWithRetry<T>(
  stint: Pick<SagaStint, 'scope' | 'activity'>,
  attempt: () => Promise<T>,
  retry: RetryPolicy,
): Promise<ActionOutcome<T>> {
  let failureCount = 0;
  while (stint.scope.alive) {
    try {
      const value = await attempt();
      if (!stint.scope.alive) {
        return { status: 'abandoned' };
      }
      return { status: 'succeeded', value };
    } catch (error) {
      if (!stint.scope.alive) {
        return { status: 'abandoned' };
      }
      const shouldRetry =
        typeof retry === 'number'
          ? failureCount < retry
          : retry(failureCount, error);
      if (!shouldRetry) {
        return { status: 'failed', error };
      }
      await stint.scope.delay(
        Math.min(1000 * 2 ** failureCount, RETRY_MAX_DELAY_MS),
      );
      failureCount += 1;
      if (!stint.scope.alive || !stint.activity.isActive()) {
        return { status: 'abandoned' };
      }
    }
  }
  return { status: 'abandoned' };
}

/** Enqueues `action` on the stint queue and applies its outcome once. */
export function runAction<T>(stint: SagaStint, action: SagaAction<T>): void {
  stint.queue.enqueue(action.key, stint.scope, async () => {
    const outcome = await runWithRetry(
      stint,
      () => action.attempt(),
      action.retry,
    );
    if (!stint.scope.alive) {
      return;
    }
    if (outcome.status === 'succeeded') {
      if (outcome.value !== undefined) {
        action.onSuccess?.(outcome.value);
      }
      return;
    }
    if (outcome.status === 'failed') {
      action.onError(outcome.error);
      if (!stint.scope.alive) {
        return;
      }
      action.onGiveUp?.();
      return;
    }
    action.onGiveUp?.();
  });
}

function upsertAccount(accounts: Account[], account: Account): Account[] {
  const index = accounts.findIndex((item) => item.id === account.id);
  if (index === -1) {
    return [...accounts, account];
  }
  const current = accounts[index];
  if (!current || account.version <= current.version) {
    return accounts;
  }
  const next = accounts.slice();
  next[index] = account;
  return next;
}

function createStintAccounts(deps: {
  userId: string;
  scope: RunScope;
  loadAccounts: (userId: string, signal: AbortSignal) => Promise<Account[]>;
}): StintAccounts {
  let snapshot: Account[] | undefined;
  let inflight: Promise<Account[]> | undefined;
  let stale = false;
  let buffer: Account[] = [];
  let generation = 0;

  const read = (): Promise<Account[]> => {
    if (snapshot && !stale) {
      return Promise.resolve(snapshot);
    }
    if (inflight) {
      return inflight;
    }
    stale = false;
    const current = ++generation;
    const promise = deps.loadAccounts(deps.userId, deps.scope.signal).then(
      (accounts) => {
        if (current !== generation) {
          return snapshot ?? accounts;
        }
        let merged = accounts;
        const pending = buffer;
        buffer = [];
        for (const account of pending) {
          merged = upsertAccount(merged, account);
        }
        snapshot = merged;
        inflight = undefined;
        return merged;
      },
      (error: unknown) => {
        if (current === generation) {
          inflight = undefined;
          snapshot = undefined;
          stale = true;
        }
        throw error;
      },
    );
    inflight = promise;
    return promise;
  };

  const requireType = async (
    id: string,
    type: 'cashu' | 'spark',
  ): Promise<Account> => {
    const account = await read().then((accounts) =>
      accounts.find((item) => item.id === id),
    );
    if (!account) {
      throw new Error(`Account not found for id: ${id}`);
    }
    if (account.type !== type) {
      throw new Error(`Account with id: ${id} is not of type: ${type}`);
    }
    return account;
  };

  return {
    getAll() {
      return read();
    },
    async get(id) {
      const accounts = await read();
      return accounts.find((account) => account.id === id);
    },
    async getCashu(id) {
      const account = await requireType(id, 'cashu');
      return account as CashuAccount;
    },
    async getSpark(id) {
      const account = await requireType(id, 'spark');
      return account as SparkAccount;
    },
    async findCashu(mintUrl, currency) {
      const accounts = await read();
      return accounts.find(
        (account): account is CashuAccount =>
          account.type === 'cashu' &&
          account.mintUrl === mintUrl &&
          account.currency === currency,
      );
    },
    apply(account) {
      if (!snapshot || inflight || stale) {
        buffer = upsertAccount(buffer, account);
      }
      if (snapshot) {
        snapshot = upsertAccount(snapshot, account);
      }
    },
    markStale() {
      stale = true;
    },
  };
}
