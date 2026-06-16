import { describe, expect, it } from 'bun:test';
import type { DomainContext } from '../context';
import type { SdkConfig } from '../../config';
import { createScanDomain } from './scan-domain';

// Real BOLT11 test vector from apps/web-wallet/app/features/scan/classify-input.test.ts
// (250,000 sats, "1 cup coffee")
const BOLT11 =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

// Real cashuB token from apps/web-wallet/app/lib/cashu/token.test.ts
// Constructed from: mint=https://mint.example.com, proof id=009a1f293253e41e, amount=1,
// secret=test-secret-1, C=02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904, unit=sat
const CASHU_TOKEN =
  'cashuBo2FteBhodHRwczovL21pbnQuZXhhbXBsZS5jb21hdWNzYXRhdIGiYWlIAJofKTJT5B5hcIGjYWEBYXNtdGVzdC1zZWNyZXQtMWFjWCECaYxOK1-VNM0Gh9h1E8dZeQz4KapXORhKPjc1Rx-9qQQ';

function domain(allowLocalhost = false) {
  const ctx = {
    config: {
      allowLocalhostLightningAddress: allowLocalhost,
    } as unknown as SdkConfig,
  } as DomainContext;
  return createScanDomain(ctx);
}

describe('scan domain parse', () => {
  it('classifies a cashu token', async () => {
    const result = await domain().parse(CASHU_TOKEN);
    expect(result.kind).toBe('cashu-token');
  });

  it('classifies a bolt11 invoice', async () => {
    const result = await domain().parse(BOLT11);
    expect(result.kind).toBe('bolt11');
    if (result.kind === 'bolt11') {
      expect(typeof result.invoice.paymentHash).toBe('string');
    }
  });

  it('classifies a lightning address', async () => {
    const result = await domain().parse('alice@agi.cash');
    expect(result).toEqual({ kind: 'ln-address', address: 'alice@agi.cash' });
  });

  it('throws DomainError on garbage', async () => {
    await expect(domain().parse('not a destination')).rejects.toThrow();
  });

  it('trims whitespace before classification', async () => {
    const result = await domain().parse(`  ${BOLT11}  `);
    expect(result.kind).toBe('bolt11');
  });

  it('lowercases lightning address', async () => {
    const result = await domain().parse('Alice@AGI.CASH');
    expect(result).toEqual({ kind: 'ln-address', address: 'alice@agi.cash' });
  });
});
