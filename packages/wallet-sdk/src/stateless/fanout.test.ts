import { describe, expect, it, mock } from 'bun:test';
import { EventBus } from '../internal/event-bus';
import { createFanout } from './fanout';

const bus = () => new EventBus<any>();
const stubAccounts = () =>
  ({
    upsert: mock(() => {}),
    reloadLast: mock(async () => {}),
  }) as any;

describe('createFanout', () => {
  it('maps `${kind}:${operation}` and carries { entity }', () => {
    const b = bus();
    const f = createFanout(b, stubAccounts());
    const seen: unknown[] = [];
    b.on('cashu-send-quote:updated', (p) => seen.push(p));
    const entity = { id: 'q1' };
    f.emit({ kind: 'cashu-send-quote', operation: 'updated', entity } as any);
    expect(seen).toEqual([{ entity }]);
  });

  it('maps all entity kinds/operations to the right row event', () => {
    const b = bus();
    const f = createFanout(b, stubAccounts());
    const cases: Array<{ kind: string; operation: 'created' | 'updated' }> = [
      { kind: 'user', operation: 'updated' },
      { kind: 'account', operation: 'created' },
      { kind: 'account', operation: 'updated' },
      { kind: 'transaction', operation: 'created' },
      { kind: 'transaction', operation: 'updated' },
      { kind: 'contact', operation: 'created' },
      { kind: 'cashu-send-quote', operation: 'created' },
      { kind: 'cashu-send-quote', operation: 'updated' },
      { kind: 'cashu-send-swap', operation: 'created' },
      { kind: 'cashu-send-swap', operation: 'updated' },
      { kind: 'cashu-receive-quote', operation: 'created' },
      { kind: 'cashu-receive-quote', operation: 'updated' },
      { kind: 'cashu-receive-swap', operation: 'created' },
      { kind: 'cashu-receive-swap', operation: 'updated' },
      { kind: 'spark-send-quote', operation: 'created' },
      { kind: 'spark-send-quote', operation: 'updated' },
      { kind: 'spark-receive-quote', operation: 'created' },
      { kind: 'spark-receive-quote', operation: 'updated' },
    ];
    for (const { kind, operation } of cases) {
      const seen: unknown[] = [];
      b.on(`${kind}:${operation}` as any, (p) => seen.push(p));
      const entity = { id: `${kind}-${operation}` };
      f.emit({ kind, operation, entity } as any);
      expect(seen).toEqual([{ entity }]);
    }
  });

  it('on account changes, upserts the resident map BEFORE emitting', () => {
    const b = bus();
    const calls: string[] = [];
    const accounts = {
      upsert: mock(() => calls.push('upsert')),
      reloadLast: mock(async () => {}),
    } as any;
    const f = createFanout(b, accounts);
    b.on('account:updated', () => calls.push('emit'));
    f.emit({
      kind: 'account',
      operation: 'updated',
      entity: { id: 'a1' },
    } as any);
    expect(calls).toEqual(['upsert', 'emit']);
  });

  it('does not upsert the resident map for non-account changes', () => {
    const b = bus();
    const accounts = stubAccounts();
    const f = createFanout(b, accounts);
    f.emit({
      kind: 'transaction',
      operation: 'updated',
      entity: { id: 't1' },
    } as any);
    expect(accounts.upsert).toHaveBeenCalledTimes(0);
  });

  it('remaps contact-deleted -> contact:deleted with { id }', () => {
    const b = bus();
    const f = createFanout(b, stubAccounts());
    const seen: unknown[] = [];
    b.on('contact:deleted', (p) => seen.push(p));
    f.emit({ kind: 'contact-deleted', id: 'c9' } as any);
    expect(seen).toEqual([{ id: 'c9' }]);
  });

  it('does not emit lifecycle (send:*/receive:*) events', () => {
    const b = bus();
    const f = createFanout(b, stubAccounts());
    const seen: string[] = [];
    for (const e of [
      'send:completed',
      'send:failed',
      'receive:completed',
      'receive:failed',
      'receive:expired',
    ] as const) {
      b.on(e, () => seen.push(e));
    }
    f.emit({
      kind: 'cashu-send-quote',
      operation: 'updated',
      entity: { id: 'q1' },
    } as any);
    f.emit({
      kind: 'cashu-receive-quote',
      operation: 'updated',
      entity: { id: 'q2' },
    } as any);
    expect(seen).toEqual([]);
  });

  it('onCatchUp does NOT emit connection:resync until the resident reload resolves, then emits it', async () => {
    const b = bus();
    let resolved = false;
    const accounts = {
      upsert: mock(() => {}),
      reloadLast: mock(async () => {
        resolved = true;
      }),
    } as any;
    const f = createFanout(b, accounts);
    const seen: string[] = [];
    b.on('connection:resync', () => seen.push('resync'));
    f.onCatchUp();
    expect(seen).toEqual([]); // not yet — reload is async
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(true);
    expect(seen).toEqual(['resync']);
  });

  it('onCatchUp still emits connection:resync if the resident reload rejects', async () => {
    const b = bus();
    const accounts = {
      upsert: mock(() => {}),
      reloadLast: mock(async () => {
        throw new Error('reload failed');
      }),
    } as any;
    const f = createFanout(b, accounts);
    const seen: string[] = [];
    b.on('connection:resync', () => seen.push('resync'));
    f.onCatchUp();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['resync']);
  });
});
