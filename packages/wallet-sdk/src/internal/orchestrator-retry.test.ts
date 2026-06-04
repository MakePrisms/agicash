import { describe, expect, mock, test } from 'bun:test';
import { MintOperationError, NetworkError } from '@cashu/cashu-ts';
import { CashuErrorCodes } from './cashu-error-codes';
import { mapVerdictToOutcome, runStep } from './orchestrator-retry';
import { ConcurrencyError, DomainError } from '../errors';

// A MintOperationError carrying a specific NUT code (the constructor takes the JSON error shape).
const mintError = (code: number) =>
  new MintOperationError(code, `mint error ${code}`);

describe('runStep — verdict → error-model mapping (all 4 buckets)', () => {
  test('a resolved step returns { kind: "resolved", value }', async () => {
    const outcome = await runStep(async () => 42);
    expect(outcome).toEqual({ kind: 'resolved', value: 42 });
  });

  test('TRANSIENT (cashu-ts NetworkError) retries, then surfaces a ConcurrencyError', async () => {
    const fn = mock(async () => {
      throw new NetworkError('offline');
    });

    await expect(runStep(fn, { maxRetries: 2 })).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
    // initial attempt + 2 retries = 3 calls.
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('TRANSIENT recovers if a retry succeeds (no error surfaced)', async () => {
    let calls = 0;
    const outcome = await runStep(
      async () => {
        calls++;
        if (calls < 2) throw new NetworkError('flaky');
        return 'ok';
      },
      { maxRetries: 3 },
    );
    expect(outcome).toEqual({ kind: 'resolved', value: 'ok' });
    expect(calls).toBe(2);
  });

  test('PERMANENT (a deterministic mint rejection) does NOT retry, surfaces a DomainError', async () => {
    const fn = mock(async () => {
      throw mintError(CashuErrorCodes.TRANSACTION_NOT_BALANCED);
    });

    await expect(runStep(fn, { maxRetries: 3 })).rejects.toBeInstanceOf(
      DomainError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('ALREADY-RESOLVED (token already spent) does NOT retry, resolves to a no-op', async () => {
    const fn = mock(async () => {
      throw mintError(CashuErrorCodes.TOKEN_ALREADY_SPENT);
    });

    const outcome = await runStep(fn, { maxRetries: 3 });

    expect(outcome).toEqual({ kind: 'already-resolved' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('UNHANDLED (an unknown error) does NOT retry, propagates the original error', async () => {
    const original = new Error('mystery');
    const fn = mock(async () => {
      throw original;
    });

    await expect(runStep(fn, { maxRetries: 3 })).rejects.toBe(original);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('a DomainError thrown by a service is permanent (surfaced, not retried)', async () => {
    const fn = mock(async () => {
      throw new DomainError('insufficient balance');
    });

    await expect(runStep(fn)).rejects.toBeInstanceOf(DomainError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('mapVerdictToOutcome — the bare mapping (no retry loop)', () => {
  test('already-resolved → { kind: "already-resolved" }', () => {
    expect(
      mapVerdictToOutcome(mintError(CashuErrorCodes.QUOTE_ALREADY_ISSUED)),
    ).toEqual({ kind: 'already-resolved' });
  });

  test('transient → throws ConcurrencyError (preserving an existing one)', () => {
    const existing = new ConcurrencyError('stale');
    expect(() => mapVerdictToOutcome(existing)).toThrow(existing);
  });

  test('permanent → throws DomainError (wrapping, preserving the message)', () => {
    let thrown: unknown;
    try {
      mapVerdictToOutcome(mintError(CashuErrorCodes.UNIT_MISMATCH));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
  });

  test('unhandled → re-throws the original untouched', () => {
    const original = { not: 'an error' };
    expect(() => mapVerdictToOutcome(original)).toThrow();
  });
});
