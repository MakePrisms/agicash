import { describe, expect, it, mock } from 'bun:test';
import type { Transaction } from '../../types/transaction';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { SdkEventMap } from '../../events';
import { inMemoryStorage, jwtWith } from '../../internal/test-support';
import type { DomainContext } from '../context';
import { createTransactionsDomain } from './transactions-domain';

const tx = (over: Partial<Transaction> = {}) =>
  ({
    id: 't1',
    acknowledgmentStatus: 'pending',
    version: 1,
    ...over,
  }) as unknown as Transaction;

function setup(repo: Record<string, unknown>) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const events: Transaction[] = [];
  emitter.on('transaction:updated', (e) => events.push(e.transaction));
  // a signed-in session: storage carries an access token whose `sub` is the user id
  const storage = inMemoryStorage({ access_token: jwtWith({ sub: 'u1' }) });
  const ctx = {
    config: { storage },
    connections: { supabase: {} },
    emitter,
  } as unknown as DomainContext;
  // inject the fake repo by spying on the repo ctor is avoided; instead the domain
  // accepts the repo via a thin seam: see Step 3 (createTransactionsDomain builds
  // `new TransactionRepository(...)`). For the test we override via the connections.
  return { emitter, events, ctx, repo };
}

describe('createTransactionsDomain', () => {
  it('acknowledge emits transaction:updated only on a real pending→acknowledged transition', async () => {
    const acknowledged = tx({
      acknowledgmentStatus: 'acknowledged',
      version: 2,
    });
    const repo = {
      acknowledge: mock(async () => acknowledged),
    };
    const { events, ctx } = setup(repo);
    const domain = createTransactionsDomain(ctx, repo as never);

    await domain.acknowledge(tx({ acknowledgmentStatus: 'pending' }));
    expect(repo.acknowledge).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.version).toBe(2);
  });

  it('acknowledge is a no-op when status is not pending', async () => {
    const repo = { acknowledge: mock(async () => tx()) };
    const { events, ctx } = setup(repo);
    const domain = createTransactionsDomain(ctx, repo as never);

    await domain.acknowledge(tx({ acknowledgmentStatus: 'acknowledged' }));
    await domain.acknowledge(tx({ acknowledgmentStatus: null }));
    expect(repo.acknowledge).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('list / get / countPendingAck delegate to the repo with the resolved user id', async () => {
    const repo = {
      list: mock(async () => ({ transactions: [], nextCursor: null })),
      get: mock(async () => null),
      countPendingAck: mock(async () => 5),
    };
    const { ctx } = setup(repo);
    const domain = createTransactionsDomain(ctx, repo as never);

    await domain.list({ pageSize: 10 });
    expect(repo.list).toHaveBeenCalledWith({ userId: 'u1', pageSize: 10 });
    expect(await domain.get('x')).toBeNull();
    expect(await domain.countPendingAck()).toBe(5);
    expect(repo.countPendingAck).toHaveBeenCalledWith('u1');
  });
});
