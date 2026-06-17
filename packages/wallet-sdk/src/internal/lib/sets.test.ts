import { describe, expect, it } from 'bun:test';
import { isSubset } from './sets';

describe('isSubset', () => {
  it('true when every element is in the superset', () => {
    expect(isSubset(new Set([1, 2]), new Set([1, 2, 3]))).toBe(true);
  });
  it('true for the empty set', () => {
    expect(isSubset(new Set<number>(), new Set([1]))).toBe(true);
  });
  it('false when an element is missing', () => {
    expect(isSubset(new Set([1, 4]), new Set([1, 2, 3]))).toBe(false);
  });
});
