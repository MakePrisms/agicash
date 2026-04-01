import { describe, expect, test } from 'bun:test';
import type { ParsedArgs } from '../src/args';
import { handleReceiveCommand } from '../src/commands/receive';
import type { SdkContext } from '../src/sdk-context';

function makeArgs(positional: string[] = [], flags: Record<string, string | boolean> = {}): ParsedArgs {
  return { command: 'receive', positional, flags: { pretty: false, ...flags } };
}

function makeMockCtx(overrides: Partial<SdkContext> = {}): SdkContext {
  return {
    userId: 'test-user',
    accountService: {} as SdkContext['accountService'],
    cashuReceiveQuoteService: {} as SdkContext['cashuReceiveQuoteService'],
    cashuReceiveSwapService: {} as SdkContext['cashuReceiveSwapService'],
    cashuSendQuoteService: {} as SdkContext['cashuSendQuoteService'],
    cashuSendSwapService: {} as SdkContext['cashuSendSwapService'],
    accountRepo: { getAll: async () => [], get: async () => { throw new Error('not found'); } } as unknown as SdkContext['accountRepo'],
    cashuReceiveQuoteRepo: { getPending: async () => [], get: async () => null } as unknown as SdkContext['cashuReceiveQuoteRepo'],
    cashuSendSwapRepo: {} as SdkContext['cashuSendSwapRepo'],
    transactionRepo: {} as SdkContext['transactionRepo'],
    cache: { fetchQuery: async ({ queryFn }) => queryFn() },
    ...overrides,
  };
}

describe('receive validation', () => {
  test('rejects missing input', async () => { const r = await handleReceiveCommand(makeArgs(), makeMockCtx()); expect(r.action).toBe('error'); expect(r.code).toBe('MISSING_INPUT'); });
  test('rejects invalid input', async () => { const r = await handleReceiveCommand(makeArgs(['abc']), makeMockCtx()); expect(r.action).toBe('error'); expect(r.code).toBe('INVALID_AMOUNT'); });
  test('rejects zero amount', async () => { const r = await handleReceiveCommand(makeArgs(['0']), makeMockCtx()); expect(r.action).toBe('error'); expect(r.code).toBe('INVALID_AMOUNT'); });
  test('rejects when no accounts', async () => { const r = await handleReceiveCommand(makeArgs(['100']), makeMockCtx()); expect(r.action).toBe('error'); expect(r.code).toBe('NO_ACCOUNT'); });
  test('rejects unknown account', async () => { const r = await handleReceiveCommand(makeArgs(['100'], { account: 'x' }), makeMockCtx()); expect(r.action).toBe('error'); expect(r.code).toBe('NO_ACCOUNT'); });
  test('detects cashu token', async () => { const r = await handleReceiveCommand(makeArgs(['cashuAinvalidtoken']), makeMockCtx()); expect(r.code).not.toBe('INVALID_AMOUNT'); });
});

describe('receive list', () => {
  test('returns empty when no pending', async () => { const r = await handleReceiveCommand(makeArgs(['list']), makeMockCtx()); expect(r.action).toBe('list'); expect(r.quotes).toEqual([]); });
});

describe('receive --check-all', () => {
  test('returns zero summary', async () => { const r = await handleReceiveCommand(makeArgs([], { 'check-all': true }), makeMockCtx()); expect(r.action).toBe('checked'); expect(r.checked).toEqual({ total: 0, completed: 0, pending: 0, failed: 0 }); });
});
