import { describe, expect, test } from 'bun:test';
import { type Token, getEncodedToken } from '@cashu/cashu-ts';
import { ScanDomainImpl } from './scan';
import { DomainError } from '../errors';

// -- Test fixtures (mirrors master scan/classify-input.test.ts) --

const CASHU_TOKEN: Token = {
  mint: 'https://mint.example.com',
  proofs: [
    {
      id: '009a1f293253e41e',
      amount: 1,
      secret: 'test-secret-1',
      C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
    },
  ],
  unit: 'sat',
};

const CASHU_A_TOKEN = getEncodedToken(CASHU_TOKEN, { version: 3 });
const CASHU_B_TOKEN = getEncodedToken(CASHU_TOKEN, { version: 4 });

// Real BOLT11 test vector (250,000 sats, "1 cup coffee")
const BOLT11_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

describe('ScanDomainImpl.parse', () => {
  const scan = new ScanDomainImpl();

  describe('cashu tokens', () => {
    test('cashuA token string → kind cashu-token', async () => {
      const result = await scan.parse(CASHU_A_TOKEN);
      expect(result.kind).toBe('cashu-token');
      if (result.kind === 'cashu-token') {
        expect(result.token.encoded).toBe(CASHU_A_TOKEN);
        expect(result.token.metadata).toBeDefined();
      }
    });

    test('cashuB token string → kind cashu-token', async () => {
      const result = await scan.parse(CASHU_B_TOKEN);
      expect(result.kind).toBe('cashu-token');
    });

    test('URL containing a cashu token', async () => {
      const result = await scan.parse(`https://example.com/#${CASHU_A_TOKEN}`);
      expect(result.kind).toBe('cashu-token');
      if (result.kind === 'cashu-token') {
        expect(result.token.encoded).toBe(CASHU_A_TOKEN);
      }
    });

    test('cashu: URI prefix', async () => {
      const result = await scan.parse(`cashu:${CASHU_A_TOKEN}`);
      expect(result.kind).toBe('cashu-token');
    });

    test('leading/trailing whitespace is trimmed', async () => {
      const result = await scan.parse(`  ${CASHU_A_TOKEN}  `);
      expect(result.kind).toBe('cashu-token');
    });
  });

  describe('bolt11 invoices', () => {
    test('raw bolt11 invoice → decoded fields', async () => {
      const result = await scan.parse(BOLT11_INVOICE);
      expect(result.kind).toBe('bolt11');
      if (result.kind === 'bolt11') {
        expect(result.invoice.amountSat).toBe(250000);
        expect(result.invoice.amountMsat).toBe(250000000);
        expect(result.invoice.description).toBe('1 cup coffee');
        expect(result.invoice.network).toBe('bitcoin');
        expect(result.invoice.paymentHash).toBe(
          '0001020304050607080900010203040506070809000102030405060708090102',
        );
      }
    });

    test('lightning: prefixed invoice', async () => {
      const result = await scan.parse(`lightning:${BOLT11_INVOICE}`);
      expect(result.kind).toBe('bolt11');
    });

    test('LIGHTNING: uppercase prefix', async () => {
      const result = await scan.parse(`LIGHTNING:${BOLT11_INVOICE}`);
      expect(result.kind).toBe('bolt11');
    });
  });

  describe('lightning addresses', () => {
    test('valid lightning address', async () => {
      const result = await scan.parse('user@domain.com');
      expect(result).toEqual({
        kind: 'ln-address',
        address: 'user@domain.com',
      });
    });

    test('uppercase address is lowercased', async () => {
      const result = await scan.parse('USER@Domain.Com');
      expect(result).toEqual({
        kind: 'ln-address',
        address: 'user@domain.com',
      });
    });

    test('address with subdomain', async () => {
      const result = await scan.parse('alice@pay.example.org');
      expect(result).toEqual({
        kind: 'ln-address',
        address: 'alice@pay.example.org',
      });
    });

    test('localhost address rejected by default', async () => {
      await expect(scan.parse('user@localhost')).rejects.toBeInstanceOf(
        DomainError,
      );
    });

    test('localhost address accepted when allowLocalhost is set', async () => {
      const devScan = new ScanDomainImpl({ allowLocalhost: true });
      const result = await devScan.parse('user@localhost:3000');
      expect(result).toEqual({
        kind: 'ln-address',
        address: 'user@localhost:3000',
      });
    });
  });

  describe('unrecognised input throws DomainError', () => {
    test('empty string', async () => {
      await expect(scan.parse('')).rejects.toBeInstanceOf(DomainError);
    });

    test('whitespace only', async () => {
      await expect(scan.parse('   ')).rejects.toBeInstanceOf(DomainError);
    });

    test('random gibberish', async () => {
      await expect(scan.parse('not a valid anything')).rejects.toBeInstanceOf(
        DomainError,
      );
    });

    test('email-like but invalid TLD', async () => {
      await expect(scan.parse('user@x')).rejects.toBeInstanceOf(DomainError);
    });

    test('bare URL without token', async () => {
      await expect(scan.parse('https://example.com')).rejects.toBeInstanceOf(
        DomainError,
      );
    });

    test('the thrown DomainError carries a stable code', async () => {
      const promise = scan.parse('garbage');
      await expect(promise).rejects.toMatchObject({
        code: 'UNRECOGNISED_DESTINATION',
      });
    });
  });

  describe('classification priority', () => {
    test('cashu token takes priority over an @-address', async () => {
      const result = await scan.parse(`user@domain.com ${CASHU_A_TOKEN}`);
      expect(result.kind).toBe('cashu-token');
    });
  });
});
