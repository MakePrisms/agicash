import { describe, expect, test } from 'bun:test';
import type { ParsedArgs } from '../src/args';
import { handleSendCommand } from '../src/commands/send';
import type { SdkContext } from '../src/sdk-context';
function makeArgs(
  positional: string[] = [],
  flags: Record<string, string | boolean> = {},
): ParsedArgs {
  return { command: 'send', positional, flags: { pretty: false, ...flags } };
}
function makeEmptyCtx(): SdkContext {
  return {
    userId: 'test-user',
    accountRepo: {
      getAll: async () => [],
      get: async () => {
        throw new Error('not found');
      },
    },
  } as unknown as SdkContext;
}
describe('send (ecash token) validation', () => {
  const emptyCtx = makeEmptyCtx();
  test('rejects missing amount', async () => {
    const r = await handleSendCommand(makeArgs(), emptyCtx);
    expect(r.action).toBe('error');
    expect(r.code).toBe('MISSING_AMOUNT');
  });
  test('rejects invalid amount', async () => {
    const r = await handleSendCommand(makeArgs(['abc']), emptyCtx);
    expect(r.action).toBe('error');
    expect(r.code).toBe('INVALID_AMOUNT');
  });
  test('rejects zero amount', async () => {
    const r = await handleSendCommand(makeArgs(['0']), emptyCtx);
    expect(r.action).toBe('error');
    expect(r.code).toBe('INVALID_AMOUNT');
  });
  test('rejects when no cashu accounts', async () => {
    const r = await handleSendCommand(makeArgs(['100']), emptyCtx);
    expect(r.action).toBe('error');
    expect(r.code).toBe('NO_ACCOUNT');
  });
  test('rejects when specified account not found', async () => {
    const ctx = {
      ...emptyCtx,
      accountRepo: {
        ...emptyCtx.accountRepo,
        get: async () => ({ type: 'spark' }),
      },
    } as unknown as SdkContext;
    const r = await handleSendCommand(makeArgs(['100'], { account: 'x' }), ctx);
    expect(r.action).toBe('error');
    expect(r.code).toBe('NO_ACCOUNT');
  });
  test('accepts amount via --amount flag', async () => {
    const r = await handleSendCommand(
      makeArgs([], { amount: '100' }),
      emptyCtx,
    );
    expect(r.action).toBe('error');
    expect(r.code).not.toBe('MISSING_AMOUNT');
    expect(r.code).not.toBe('INVALID_AMOUNT');
  });
});
