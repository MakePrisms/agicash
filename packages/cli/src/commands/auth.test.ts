import { describe, expect, test } from 'bun:test';
import type { ParsedArgs } from '../args';
import { validateAuthArgs } from './auth';

const makeArgs = (
  positional: string[],
  flags: Record<string, string | boolean> = {},
): ParsedArgs => ({
  command: 'auth',
  positional,
  flags: { pretty: false, ...flags },
});

describe('auth arg validation', () => {
  test('no subcommand returns error', () => {
    const result = validateAuthArgs(makeArgs([]));
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_SUBCOMMAND');
  });

  test('unknown subcommand returns error', () => {
    const result = validateAuthArgs(makeArgs(['foo']));
    expect(result.action).toBe('error');
    expect(result.code).toBe('UNKNOWN_SUBCOMMAND');
  });

  test('login without email returns error', () => {
    const result = validateAuthArgs(makeArgs(['login']));
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_EMAIL');
  });

  test('login without password returns error', () => {
    const result = validateAuthArgs(makeArgs(['login', 'test@example.com']));
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_PASSWORD');
  });

  test('login with email and password passes validation', () => {
    const result = validateAuthArgs(
      makeArgs(['login', 'test@example.com', 'pass123']),
    );
    expect(result.action).toBe('validated');
  });

  test('signup without email returns error', () => {
    const result = validateAuthArgs(makeArgs(['signup']));
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_EMAIL');
  });

  test('signup without password returns error', () => {
    const result = validateAuthArgs(makeArgs(['signup', 'test@example.com']));
    expect(result.action).toBe('error');
    expect(result.code).toBe('MISSING_PASSWORD');
  });

  test('signup with email and password passes validation', () => {
    const result = validateAuthArgs(
      makeArgs(['signup', 'test@example.com', 'pass123']),
    );
    expect(result.action).toBe('validated');
  });

  test('logout passes validation with no extra args', () => {
    const result = validateAuthArgs(makeArgs(['logout']));
    expect(result.action).toBe('validated');
  });

  test('status passes validation with no extra args', () => {
    const result = validateAuthArgs(makeArgs(['status']));
    expect(result.action).toBe('validated');
  });

  test('guest passes validation with no extra args', () => {
    const result = validateAuthArgs(makeArgs(['guest']));
    expect(result.action).toBe('validated');
  });
});
