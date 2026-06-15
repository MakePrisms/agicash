import { describe, expect, it } from 'bun:test';
import {
  ConcurrencyError,
  DomainError,
  NotFoundError,
  SdkError,
} from '../errors';
import { classify } from './classify';

describe('classify', () => {
  it('passes through an existing SdkError unchanged', () => {
    const e = new DomainError('nope', 'X');
    expect(classify(e)).toBe(e);
  });
  it('maps 23505 → DomainError/UNIQUE_CONSTRAINT', () => {
    const r = classify({ code: '23505', message: 'dup' });
    expect(r).toBeInstanceOf(DomainError);
    expect(r.code).toBe('UNIQUE_CONSTRAINT');
  });
  it('maps RPC hint CONCURRENCY_ERROR → ConcurrencyError', () => {
    const r = classify({ hint: 'CONCURRENCY_ERROR', message: 'conflict' });
    expect(r).toBeInstanceOf(ConcurrencyError);
    expect(r.code).toBe('CONCURRENCY_ERROR');
  });
  it('maps PGRST116 → NotFoundError/NOT_FOUND', () => {
    const r = classify({ code: 'PGRST116', message: 'no rows' });
    expect(r).toBeInstanceOf(NotFoundError);
    expect(r.code).toBe('NOT_FOUND');
  });
  it('maps a fetch failure → SdkError/NETWORK_ERROR', () => {
    const r = classify(new TypeError('fetch failed'));
    expect(r.code).toBe('NETWORK_ERROR');
  });
  it('falls through to SdkError/UNKNOWN', () => {
    const r = classify(new Error('weird'));
    expect(r).toBeInstanceOf(SdkError);
    expect(r.code).toBe('UNKNOWN');
    expect(r.message).toBe('weird');
  });
});
