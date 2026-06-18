import { describe, expect, it } from 'bun:test';
import { makeFakeDb } from '../test-support';
import { TaskProcessingLockRepository } from './task-processing-lock-repository';

describe('TaskProcessingLockRepository', () => {
  it('calls the take_lead RPC with p_user_id/p_client_id and returns the boolean', async () => {
    const calls: { rpc: { name: string; args: unknown }[] } = { rpc: [] };
    const db = makeFakeDb({ rpcResult: { data: true, error: null }, calls });
    const repo = new TaskProcessingLockRepository(db);
    const result = await repo.takeLead('user-1', 'client-1');
    expect(result).toBe(true);
    expect(calls.rpc).toContainEqual({
      name: 'take_lead',
      args: { p_user_id: 'user-1', p_client_id: 'client-1' },
    });
  });

  it('returns false when the RPC returns null/false', async () => {
    const db = makeFakeDb({ rpcResult: { data: false, error: null } });
    const repo = new TaskProcessingLockRepository(db);
    expect(await repo.takeLead('user-1', 'client-1')).toBe(false);
  });

  it('throws (via classify) when the RPC errors', async () => {
    const db = makeFakeDb({
      rpcResult: { data: null, error: { message: 'boom', code: 'XX000' } },
    });
    const repo = new TaskProcessingLockRepository(db);
    await expect(repo.takeLead('user-1', 'client-1')).rejects.toBeDefined();
  });
});
