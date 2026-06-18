import { describe, expect, it, mock } from 'bun:test';
import { SdkEventEmitter } from '../event-emitter';
import type { SdkEventMap } from '../../events';
import { WalletChangesForwarder } from './wallet-changes-forwarder';

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeRealtime() {
  let broadcastCb:
    | ((m: { type: 'broadcast'; event: string; payload: unknown }) => void)
    | undefined;
  const subscribe = mock(async () => {});
  const removeChannel = mock(async () => {});
  const builder = {
    topic: 'realtime:wallet:user-1',
    on: mock(
      (
        _type: string,
        _filter: unknown,
        cb: (m: { type: 'broadcast'; event: string; payload: unknown }) => void,
      ) => {
        broadcastCb = cb;
        return builder;
      },
    ),
  };
  const channel = mock(() => builder);
  const addChannel = mock(() => ({ topic: builder.topic }));
  const realtime = { channel, addChannel, subscribe, removeChannel } as never;
  return {
    realtime,
    subscribe,
    removeChannel,
    fire: (event: string, payload: unknown) =>
      broadcastCb?.({ type: 'broadcast', event, payload }),
  };
}

function setup() {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const events: { name: string; data: unknown }[] = [];
  (
    [
      'transaction:created',
      'transaction:updated',
      'account:updated',
      'user:updated',
      'contact:created',
      'contact:deleted',
    ] as const
  ).forEach((name) => emitter.on(name, (data) => events.push({ name, data })));
  const rt = fakeRealtime();
  const transactionRepository = {
    toTransaction: mock(async (row: { id: string; version: number }) => ({
      id: row.id,
      version: row.version,
    })),
  } as never;
  const accountRepository = {
    toAccount: mock(async (row: { id: string }) => ({ id: row.id })),
  } as never;
  const toUser = mock((row: { id: string }) => ({ id: row.id, username: 'u' }));
  const forwarder = new WalletChangesForwarder({
    realtime: rt.realtime,
    emitter,
    transactionRepository,
    accountRepository,
    toUser: toUser as never,
  });
  return { forwarder, emitter, events, rt, toUser };
}

describe('WalletChangesForwarder', () => {
  it('subscribes the private wallet:<userId> broadcast channel on start', async () => {
    const { forwarder, rt } = setup();
    await forwarder.start('user-1');
    expect(rt.subscribe).toHaveBeenCalledTimes(1);
  });

  it('maps TRANSACTION_CREATED/UPDATED to transaction:created/:updated', async () => {
    const { forwarder, events, rt } = setup();
    await forwarder.start('user-1');
    rt.fire('TRANSACTION_CREATED', { id: 'tx-1', version: 1 });
    rt.fire('TRANSACTION_UPDATED', { id: 'tx-1', version: 2 });
    await flush();
    expect(events.map((e) => e.name)).toEqual([
      'transaction:created',
      'transaction:updated',
    ]);
  });

  it('maps ACCOUNT_CREATED/UPDATED to account:updated with the right op', async () => {
    const { forwarder, events, rt } = setup();
    await forwarder.start('user-1');
    rt.fire('ACCOUNT_CREATED', { id: 'acc-1' });
    rt.fire('ACCOUNT_UPDATED', { id: 'acc-1' });
    await flush();
    expect(events).toEqual([
      {
        name: 'account:updated',
        data: { account: { id: 'acc-1' }, op: 'created' },
      },
      {
        name: 'account:updated',
        data: { account: { id: 'acc-1' }, op: 'updated' },
      },
    ]);
  });

  it('maps USER_UPDATED to user:updated', async () => {
    const { forwarder, events, rt } = setup();
    await forwarder.start('user-1');
    rt.fire('USER_UPDATED', { id: 'user-1' });
    await flush();
    expect(events).toEqual([
      { name: 'user:updated', data: { user: { id: 'user-1', username: 'u' } } },
    ]);
  });

  it('does NOT drive contact events (S8 owns them) or quote/swap events', async () => {
    const { forwarder, events, rt } = setup();
    await forwarder.start('user-1');
    rt.fire('CONTACT_CREATED', { id: 'c-1' });
    rt.fire('CONTACT_DELETED', { id: 'c-1' });
    rt.fire('CASHU_SEND_QUOTE_UPDATED', { id: 'q-1' });
    await flush();
    expect(events).toHaveLength(0);
  });

  it('removes the channel on stop', async () => {
    const { forwarder, rt } = setup();
    await forwarder.start('user-1');
    await forwarder.stop();
    expect(rt.removeChannel).toHaveBeenCalledTimes(1);
  });
});
