import { describe, expect, test } from 'bun:test';
import {
  ConcurrencyError,
  DomainError,
  getErrorMessage,
  NotFoundError,
  SdkError,
  UniqueConstraintError,
} from './errors';

describe('error taxonomy', () => {
  test('all SDK errors extend SdkError and Error', () => {
    for (const err of [
      new DomainError('d'),
      new ConcurrencyError('c'),
      new NotFoundError('n'),
      new UniqueConstraintError('u'),
    ]) {
      expect(err).toBeInstanceOf(SdkError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  test('names are set for discrimination', () => {
    expect(new DomainError('d').name).toBe('DomainError');
    expect(new ConcurrencyError('c').name).toBe('ConcurrencyError');
    expect(new NotFoundError('n').name).toBe('NotFoundError');
    expect(new UniqueConstraintError('u').name).toBe('UniqueConstraintError');
  });

  test('ConcurrencyError carries optional details', () => {
    expect(new ConcurrencyError('c', 'row 5').details).toBe('row 5');
    expect(new ConcurrencyError('c').details).toBeUndefined();
  });

  test('getErrorMessage extracts message or falls back', () => {
    expect(getErrorMessage('boom')).toBe('boom');
    expect(getErrorMessage(new Error('nope'))).toBe('nope');
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
  });
});
