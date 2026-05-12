import { describe, expect, test } from 'bun:test';
import { buildZapReceiptTemplate } from './zap-receipt-builder';
import type { ValidatedZapRequest } from './zap-request-validator';

const baseRequest: ValidatedZapRequest = {
  pubkey: 'a'.repeat(64),
  content: 'thanks',
  pTag: 'b'.repeat(64),
  relays: ['wss://relay.example.com'],
  rawJson: '{"kind":9734,"tags":[["p","' + 'b'.repeat(64) + '"]]}',
};

describe('buildZapReceiptTemplate', () => {
  test('includes required p, bolt11, description tags', () => {
    const template = buildZapReceiptTemplate({
      zapRequest: baseRequest,
      bolt11: 'lnbc1...',
      paidAtUnixSec: 1_700_000_000,
    });

    expect(template.kind).toBe(9735);
    expect(template.created_at).toBe(1_700_000_000);
    expect(template.content).toBe('');
    expect(template.tags).toContainEqual(['p', 'b'.repeat(64)]);
    expect(template.tags).toContainEqual(['bolt11', 'lnbc1...']);
    expect(template.tags).toContainEqual(['description', baseRequest.rawJson]);
  });

  test('preserves exact rawJson in description tag', () => {
    const template = buildZapReceiptTemplate({
      zapRequest: baseRequest,
      bolt11: 'lnbc1...',
      paidAtUnixSec: 1_700_000_000,
    });
    const descriptionTag = template.tags.find((t) => t[0] === 'description');
    expect(descriptionTag?.[1]).toBe(baseRequest.rawJson);
  });

  test('mirrors optional e tag when present', () => {
    const template = buildZapReceiptTemplate({
      zapRequest: { ...baseRequest, eTag: 'event-id-123' },
      bolt11: 'lnbc1...',
      paidAtUnixSec: 1_700_000_000,
    });
    expect(template.tags).toContainEqual(['e', 'event-id-123']);
  });

  test('mirrors optional a, P, k tags when present', () => {
    const template = buildZapReceiptTemplate({
      zapRequest: {
        ...baseRequest,
        aTag: '30023:pubkey:slug',
        PTag: 'c'.repeat(64),
        kTag: '1',
      },
      bolt11: 'lnbc1...',
      paidAtUnixSec: 1_700_000_000,
    });
    expect(template.tags).toContainEqual(['a', '30023:pubkey:slug']);
    expect(template.tags).toContainEqual(['P', 'c'.repeat(64)]);
    expect(template.tags).toContainEqual(['k', '1']);
  });

  test('omits optional tags when absent on request', () => {
    const template = buildZapReceiptTemplate({
      zapRequest: baseRequest,
      bolt11: 'lnbc1...',
      paidAtUnixSec: 1_700_000_000,
    });
    expect(template.tags.find((t) => t[0] === 'e')).toBeUndefined();
    expect(template.tags.find((t) => t[0] === 'a')).toBeUndefined();
    expect(template.tags.find((t) => t[0] === 'P')).toBeUndefined();
    expect(template.tags.find((t) => t[0] === 'k')).toBeUndefined();
    expect(template.tags.find((t) => t[0] === 'preimage')).toBeUndefined();
  });

  test('includes preimage when provided', () => {
    const template = buildZapReceiptTemplate({
      zapRequest: baseRequest,
      bolt11: 'lnbc1...',
      paidAtUnixSec: 1_700_000_000,
      preimage: 'd'.repeat(64),
    });
    expect(template.tags).toContainEqual(['preimage', 'd'.repeat(64)]);
  });

  test('uses paidAtUnixSec as created_at for idempotency', () => {
    const t1 = buildZapReceiptTemplate({
      zapRequest: baseRequest,
      bolt11: 'lnbc1...',
      paidAtUnixSec: 1_700_000_000,
    });
    const t2 = buildZapReceiptTemplate({
      zapRequest: baseRequest,
      bolt11: 'lnbc1...',
      paidAtUnixSec: 1_700_000_000,
    });
    expect(t1.created_at).toBe(t2.created_at);
    expect(JSON.stringify(t1.tags)).toBe(JSON.stringify(t2.tags));
  });
});
