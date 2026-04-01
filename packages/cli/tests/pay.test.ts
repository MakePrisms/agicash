import { describe, expect, test } from 'bun:test';
import type { ParsedArgs } from '../src/args';
import { handlePayCommand } from '../src/commands/pay';
import type { SdkContext } from '../src/sdk-context';
function makeArgs(positional: string[] = [], flags: Record<string, string | boolean> = {}): ParsedArgs { return { command: 'pay', positional, flags: { pretty: false, ...flags } }; }
function makeEmptyCtx(): SdkContext { return { userId: 'test-user', accountRepo: { getAll: async () => [], get: async () => { throw new Error('not found'); } } } as unknown as SdkContext; }
describe('pay validation', () => {
  const emptyCtx = makeEmptyCtx();
  test('rejects missing invoice', async () => { const r = await handlePayCommand(makeArgs(), emptyCtx); expect(r.action).toBe('error'); expect(r.code).toBe('MISSING_INVOICE'); });
  test('rejects invalid invoice', async () => { const r = await handlePayCommand(makeArgs([], { bolt11: 'notaninvoice' }), emptyCtx); expect(r.action).toBe('error'); expect(r.code).toBe('INVALID_INVOICE'); });
  test('accepts invoice as positional arg', async () => { const r = await handlePayCommand(makeArgs(['lnbc100n1invalid']), emptyCtx); expect(r.code).not.toBe('MISSING_INVOICE'); expect(r.code).not.toBe('INVALID_INVOICE'); });
  test('rejects when no cashu accounts', async () => { const r = await handlePayCommand(makeArgs([], { bolt11: 'lnbc100n1test' }), emptyCtx); expect(r.action).toBe('error'); expect(r.code).toBe('NO_ACCOUNT'); });
  test('rejects when specified account not found', async () => { const ctx = { ...emptyCtx, accountRepo: { ...emptyCtx.accountRepo, get: async () => ({ type: 'spark' }) } } as unknown as SdkContext; const r = await handlePayCommand(makeArgs([], { bolt11: 'lnbc100n1test', account: 'x' }), ctx); expect(r.action).toBe('error'); expect(r.code).toBe('NO_ACCOUNT'); });
});
