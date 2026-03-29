import { describe, expect, test } from 'bun:test';
import { getLocaleDecimalSeparator } from '@agicash/sdk/lib/locale/index';

describe('getLocaleDecimalSeparator', () => {
  test('returns "." for en-US locale', () => {
    expect(getLocaleDecimalSeparator('en-US')).toBe('.');
  });

  test('returns "," for de-DE locale', () => {
    expect(getLocaleDecimalSeparator('de-DE')).toBe(',');
  });
});
