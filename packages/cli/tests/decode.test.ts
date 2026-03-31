import { describe, expect, test } from 'bun:test';
import type { ParsedArgs } from '../src/args';
import { handleDecodeCommand } from '../src/commands/decode';

function makeArgs(
  positional: string[] = [],
  flags: Record<string, string | boolean> = {},
): ParsedArgs {
  return {
    command: 'decode',
    positional,
    flags: { pretty: false, ...flags },
  };
}

describe('decode', () => {
  test('rejects missing input', async () => {
    const result = await handleDecodeCommand(makeArgs());
    expect(result.type).toBe('error');
    expect(result.code).toBe('MISSING_INPUT');
  });

  test('detects and decodes cashu token', async () => {
    // A minimal cashu token for testing
    // We'll test with a real-ish prefix detection
    const result = await handleDecodeCommand(
      makeArgs(['cashuAeyJ0b2tlbiI6eyJ']),
    );
    // Should detect as cashu_token type even if decode fails (malformed)
    expect(result.type).toBe('cashu_token');
  });

  test('detects bolt11 invoice', async () => {
    // Use a real testnet invoice prefix
    const result = await handleDecodeCommand(makeArgs(['lnbc10n1ptest']));
    expect(result.type).toBe('bolt11');
  });

  test('detects lnurl', async () => {
    const result = await handleDecodeCommand(
      makeArgs(['lnurl1dp68gurn8ghj7test']),
    );
    expect(result.type).toBe('lnurl');
    expect(result.data?.hint).toBeDefined();
  });

  test('detects lightning address', async () => {
    const result = await handleDecodeCommand(makeArgs(['satoshi@bitcoin.org']));
    expect(result.type).toBe('lightning_address');
    expect(result.data?.user).toBe('satoshi');
    expect(result.data?.domain).toBe('bitcoin.org');
    expect(result.data?.lnurlp_url).toBe(
      'https://bitcoin.org/.well-known/lnurlp/satoshi',
    );
  });

  test('detects URL (potential mint)', async () => {
    const result = await handleDecodeCommand(
      makeArgs(['https://testnut.cashu.space']),
    );
    expect(result.type).toBe('url');
    expect(result.data?.host).toBe('testnut.cashu.space');
  });

  test('returns unknown for unrecognized input', async () => {
    const result = await handleDecodeCommand(makeArgs(['hello-world']));
    expect(result.type).toBe('unknown');
    expect(result.code).toBe('UNKNOWN_TYPE');
  });

  test('accepts input via --input flag', async () => {
    const result = await handleDecodeCommand(
      makeArgs([], { input: 'satoshi@bitcoin.org' }),
    );
    expect(result.type).toBe('lightning_address');
  });
});
