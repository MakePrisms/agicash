import { describe, expect, test } from 'bun:test';
import { parseArgs } from '../src/args';
import { formatOutput } from '../src/output';

describe('parseArgs', () => {
  test('parses command name', () => {
    const result = parseArgs(['balance']);
    expect(result.command).toBe('balance');
  });

  test('returns help command when no args', () => {
    const result = parseArgs([]);
    expect(result.command).toBe('help');
  });

  test('returns help command for --help flag', () => {
    const result = parseArgs(['--help']);
    expect(result.command).toBe('help');
  });

  test('returns version command for --version flag', () => {
    const result = parseArgs(['--version']);
    expect(result.command).toBe('version');
  });

  test('parses --pretty flag', () => {
    const result = parseArgs(['balance', '--pretty']);
    expect(result.command).toBe('balance');
    expect(result.flags.pretty).toBe(true);
  });

  test('pretty defaults to false', () => {
    const result = parseArgs(['balance']);
    expect(result.flags.pretty).toBe(false);
  });

  test('collects positional args after command', () => {
    const result = parseArgs(['mint', 'add', 'https://mint.example.com']);
    expect(result.command).toBe('mint');
    expect(result.positional).toEqual(['add', 'https://mint.example.com']);
  });

  test('parses named flags with values', () => {
    const result = parseArgs(['send', '--amount', '100', '--unit', 'sat']);
    expect(result.command).toBe('send');
    expect(result.flags.amount).toBe('100');
    expect(result.flags.unit).toBe('sat');
  });
});

describe('formatOutput', () => {
  test('outputs JSON by default', () => {
    const data = { balance: 1000, unit: 'sat' };
    const result = formatOutput(data, { pretty: false });
    expect(result).toBe('{"balance":1000,"unit":"sat"}');
    expect(() => JSON.parse(result)).not.toThrow();
  });

  test('outputs pretty JSON with --pretty', () => {
    const data = { balance: 1000, unit: 'sat' };
    const result = formatOutput(data, { pretty: true });
    expect(result).toBe(JSON.stringify(data, null, 2));
    expect(result).toContain('\n');
  });

  test('handles error output', () => {
    const error = { error: 'mint not found', code: 'MINT_NOT_FOUND' };
    const result = formatOutput(error, { pretty: false });
    const parsed = JSON.parse(result);
    expect(parsed.error).toBe('mint not found');
    expect(parsed.code).toBe('MINT_NOT_FOUND');
  });

  test('handles arrays', () => {
    const data = [{ mint: 'https://a.com' }, { mint: 'https://b.com' }];
    const result = formatOutput(data, { pretty: false });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
  });
});
