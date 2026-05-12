import { describe, expect, test } from 'bun:test';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from 'nostr-tools/pure';
import { parseAndValidateZapRequest } from './zap-request-validator';

function makeZapRequest({
  zapperSecret = generateSecretKey(),
  recipient = '0'.repeat(64),
  amountMsat,
  relays = ['wss://relay.damus.io', 'wss://nos.lol'],
  content = '',
  extraTags = [] as string[][],
}: {
  zapperSecret?: Uint8Array;
  recipient?: string;
  amountMsat?: number;
  relays?: string[];
  content?: string;
  extraTags?: string[][];
} = {}) {
  const tags: string[][] = [
    ['relays', ...relays],
    ['p', recipient],
  ];
  if (amountMsat !== undefined) {
    tags.push(['amount', String(amountMsat)]);
  }
  for (const t of extraTags) {
    tags.push(t);
  }
  return finalizeEvent(
    {
      kind: 9734,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    },
    zapperSecret,
  );
}

function encode(event: object): string {
  return encodeURIComponent(JSON.stringify(event));
}

describe('parseAndValidateZapRequest', () => {
  test('accepts a valid zap request', () => {
    const event = makeZapRequest({ amountMsat: 21_000 });
    const result = parseAndValidateZapRequest(encode(event), 21_000);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.pubkey).toBe(event.pubkey);
    expect(result.pTag).toBe('0'.repeat(64));
    expect(result.relays).toEqual(['wss://relay.damus.io', 'wss://nos.lol']);
    expect(result.amountTag).toBe('21000');
  });

  test('accepts when amount tag is absent', () => {
    const event = makeZapRequest();
    const result = parseAndValidateZapRequest(encode(event), 21_000);
    expect('error' in result).toBe(false);
  });

  test('rejects malformed JSON', () => {
    const result = parseAndValidateZapRequest('not%20json', 21_000);
    expect('error' in result).toBe(true);
  });

  test('rejects a bad signature', () => {
    const event = makeZapRequest({ amountMsat: 21_000 });
    const tampered = { ...event, content: 'tampered' };
    const result = parseAndValidateZapRequest(encode(tampered), 21_000);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/signature/i);
    }
  });

  test('rejects missing p tag', () => {
    const sk = generateSecretKey();
    const event = finalizeEvent(
      {
        kind: 9734,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['relays', 'wss://relay.damus.io']],
        content: '',
      },
      sk,
    );
    const result = parseAndValidateZapRequest(encode(event), 21_000);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/p tag/);
    }
  });

  test('rejects multiple p tags', () => {
    const event = makeZapRequest({
      extraTags: [['p', '1'.repeat(64)]],
    });
    const result = parseAndValidateZapRequest(encode(event), 21_000);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/p tag/);
    }
  });

  test('rejects amount tag mismatch', () => {
    const event = makeZapRequest({ amountMsat: 21_000 });
    const result = parseAndValidateZapRequest(encode(event), 10_000);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/amount/i);
    }
  });

  test('rejects missing relays tag', () => {
    const sk = generateSecretKey();
    const event = finalizeEvent(
      {
        kind: 9734,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', '0'.repeat(64)]],
        content: '',
      },
      sk,
    );
    const result = parseAndValidateZapRequest(encode(event), 21_000);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/relays/i);
    }
  });

  test('rejects empty relays tag', () => {
    const sk = generateSecretKey();
    const event = finalizeEvent(
      {
        kind: 9734,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['relays'], ['p', '0'.repeat(64)]],
        content: '',
      },
      sk,
    );
    const result = parseAndValidateZapRequest(encode(event), 21_000);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/relays/i);
    }
  });

  test('preserves rawJson exactly', () => {
    const event = makeZapRequest({ amountMsat: 21_000 });
    const json = JSON.stringify(event);
    const result = parseAndValidateZapRequest(encodeURIComponent(json), 21_000);
    if ('error' in result) throw new Error('unexpected error');
    expect(result.rawJson).toBe(json);
  });

  test('captures optional e/a/P/k tags', () => {
    const event = makeZapRequest({
      extraTags: [
        ['e', 'event-id'],
        ['a', '30023:pubkey:slug'],
        ['P', getPublicKey(generateSecretKey())],
        ['k', '1'],
      ],
    });
    const result = parseAndValidateZapRequest(encode(event), 21_000);
    if ('error' in result) throw new Error('unexpected error');
    expect(result.eTag).toBe('event-id');
    expect(result.aTag).toBe('30023:pubkey:slug');
    expect(result.PTag).toBeDefined();
    expect(result.kTag).toBe('1');
  });
});
