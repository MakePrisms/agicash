import { describe, expect, test } from 'bun:test';
import { MintOperationError } from '@cashu/cashu-ts';
import { CashuErrorCodes } from './error-codes';
import { formatCashuQuoteError } from './quote-errors';

const buildQuotaError = (detail: string, data: unknown): MintOperationError => {
  const error = new MintOperationError(
    CashuErrorCodes.MINT_QUOTA_EXCEEDED,
    detail,
  );
  // The mint sends a structured `data` field that cashu-ts does not yet
  // surface on the error type. Attach it directly so the formatter can
  // exercise the friendly-message path.
  (error as MintOperationError & { data?: unknown }).data = data;
  return error;
};

describe('formatCashuQuoteError', () => {
  test('returns friendly message for 33001 with full data and retry-after', () => {
    const error = buildQuotaError('Mint quota exceeded: ₿600 of ₿1,000.', {
      limit: 1000,
      used: 600,
      unit: 'sat',
      window_secs: 86400,
      retry_after: 3600,
    });

    expect(formatCashuQuoteError(error)).toBe(
      'Amount exceeds remaining daily limit of ₿400. Try again in 1h',
    );
  });

  test('returns friendly message for 33001 with full data and no retry-after', () => {
    const error = buildQuotaError('Mint quota exceeded.', {
      limit: 5000,
      used: 1234,
      unit: 'sat',
      window_secs: 86400,
    });

    expect(formatCashuQuoteError(error)).toBe(
      'Amount exceeds remaining daily limit of ₿3,766',
    );
  });

  test('clamps remaining to zero when used exceeds limit', () => {
    const error = buildQuotaError('Mint quota exceeded.', {
      limit: 100,
      used: 200,
      unit: 'sat',
    });

    expect(formatCashuQuoteError(error)).toBe(
      'Amount exceeds remaining daily limit of ₿0',
    );
  });

  test('falls back to detail when 33001 has no structured data', () => {
    const detail = 'Mint quota exceeded: ₿600 of ₿1,000. Try again in 1h.';
    const error = new MintOperationError(
      CashuErrorCodes.MINT_QUOTA_EXCEEDED,
      detail,
    );

    expect(formatCashuQuoteError(error)).toBe(detail);
  });

  test('falls back to detail when 33001 has malformed data', () => {
    const detail = 'Mint quota exceeded.';
    const error = buildQuotaError(detail, { limit: 'not-a-number' });

    expect(formatCashuQuoteError(error)).toBe(detail);
  });

  test('falls back to detail when 33001 has unknown unit', () => {
    const detail = 'Mint quota exceeded for eur unit.';
    const error = buildQuotaError(detail, {
      limit: 100,
      used: 25,
      unit: 'eur',
    });

    expect(formatCashuQuoteError(error)).toBe(detail);
  });

  test('passes through non-quota MintOperationError unchanged', () => {
    const error = new MintOperationError(
      CashuErrorCodes.QUOTE_NOT_PAID,
      'Quote not paid',
    );

    expect(formatCashuQuoteError(error)).toBe('Quote not paid');
  });

  test('returns message for generic Error instances', () => {
    expect(formatCashuQuoteError(new Error('network failure'))).toBe(
      'network failure',
    );
  });

  test('returns string representation for non-Error inputs', () => {
    expect(formatCashuQuoteError('unexpected')).toBe('unexpected');
    expect(formatCashuQuoteError(null)).toBe('null');
    expect(formatCashuQuoteError(undefined)).toBe('undefined');
  });

  test('humanizes retry-after under one minute', () => {
    const error = buildQuotaError('quota', {
      limit: 100,
      used: 50,
      unit: 'sat',
      retry_after: 45,
    });

    expect(formatCashuQuoteError(error)).toBe(
      'Amount exceeds remaining daily limit of ₿50. Try again in 45s',
    );
  });

  test('humanizes retry-after spanning hours and minutes', () => {
    const error = buildQuotaError('quota', {
      limit: 100,
      used: 50,
      unit: 'sat',
      retry_after: 3 * 3600 + 30 * 60,
    });

    expect(formatCashuQuoteError(error)).toBe(
      'Amount exceeds remaining daily limit of ₿50. Try again in 3h 30m',
    );
  });

  test('humanizes retry-after spanning days', () => {
    const error = buildQuotaError('quota', {
      limit: 100,
      used: 50,
      unit: 'sat',
      retry_after: 2 * 86400 + 5 * 3600,
    });

    expect(formatCashuQuoteError(error)).toBe(
      'Amount exceeds remaining daily limit of ₿50. Try again in 2d 5h',
    );
  });

  test('formats usd unit as cents under the USD currency', () => {
    const error = buildQuotaError('quota', {
      limit: 10000,
      used: 7500,
      unit: 'usd',
    });

    expect(formatCashuQuoteError(error)).toBe(
      'Amount exceeds remaining daily limit of 2,500¢',
    );
  });
});
