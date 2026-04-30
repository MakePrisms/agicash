import { describe, expect, test } from 'bun:test';
import { type Token, getEncodedToken } from '@cashu/cashu-ts';
import { classifyInput } from './classify-input';

// -- Test fixtures --

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

// Real BOLT11 test vector from bolt11.test.ts (250,000 sats, "1 cup coffee")
const BOLT11_INVOICE =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';

// -- Tests --

describe('classifyInput', () => {
  describe('cashu tokens', () => {
    test('cashuA token string', () => {
      const result = classifyInput(CASHU_A_TOKEN);
      expect(result).toEqual({
        direction: 'receive',
        type: 'cashu-token',
        encoded: CASHU_A_TOKEN,
      });
    });

    test('cashuB token string', () => {
      const result = classifyInput(CASHU_B_TOKEN);
      expect(result).toEqual({
        direction: 'receive',
        type: 'cashu-token',
        encoded: CASHU_B_TOKEN,
      });
    });

    test('URL containing cashu token', () => {
      const result = classifyInput(`https://example.com/#${CASHU_A_TOKEN}`);
      expect(result).toEqual({
        direction: 'receive',
        type: 'cashu-token',
        encoded: CASHU_A_TOKEN,
      });
    });

    test('token with leading/trailing whitespace', () => {
      const result = classifyInput(`  ${CASHU_A_TOKEN}  `);
      expect(result?.type).toBe('cashu-token');
    });

    test('cashu: URI prefix', () => {
      const result = classifyInput(`cashu:${CASHU_A_TOKEN}`);
      expect(result).toEqual({
        direction: 'receive',
        type: 'cashu-token',
        encoded: CASHU_A_TOKEN,
      });
    });
  });

  describe('bolt11 invoices', () => {
    test('raw bolt11 invoice with full decoded data', () => {
      const result = classifyInput(BOLT11_INVOICE);
      expect(result).toEqual({
        direction: 'send',
        type: 'bolt11',
        invoice: BOLT11_INVOICE,
        decoded: {
          amountMsat: 250000000,
          amountSat: 250000,
          createdAtUnixMs: 1496314658000,
          expiryUnixMs: 1496314718000,
          network: 'bitcoin',
          description: '1 cup coffee',
          paymentHash:
            '0001020304050607080900010203040506070809000102030405060708090102',
        },
      });
    });

    test('lightning: prefixed invoice', () => {
      const result = classifyInput(`lightning:${BOLT11_INVOICE}`);
      expect(result?.type).toBe('bolt11');
      if (result?.type === 'bolt11') {
        expect(result.invoice).toBe(BOLT11_INVOICE);
      }
    });

    test('LIGHTNING: uppercase prefix', () => {
      const result = classifyInput(`LIGHTNING:${BOLT11_INVOICE}`);
      expect(result?.type).toBe('bolt11');
      if (result?.type === 'bolt11') {
        expect(result.invoice).toBe(BOLT11_INVOICE);
      }
    });
  });

  describe('lightning addresses', () => {
    test('valid lightning address', () => {
      const result = classifyInput('user@domain.com');
      expect(result).toEqual({
        direction: 'send',
        type: 'ln-address',
        address: 'user@domain.com',
      });
    });

    test('uppercase address is lowercased', () => {
      const result = classifyInput('USER@Domain.Com');
      expect(result).toEqual({
        direction: 'send',
        type: 'ln-address',
        address: 'user@domain.com',
      });
    });

    test('address with subdomain', () => {
      const result = classifyInput('alice@pay.example.org');
      expect(result).toEqual({
        direction: 'send',
        type: 'ln-address',
        address: 'alice@pay.example.org',
      });
    });
  });

  describe('unknown inputs', () => {
    test('empty string', () => {
      expect(classifyInput('')).toBeNull();
    });

    test('whitespace only', () => {
      expect(classifyInput('   ')).toBeNull();
    });

    test('random gibberish', () => {
      expect(classifyInput('not a valid anything')).toBeNull();
    });

    test('email-like but invalid TLD', () => {
      expect(classifyInput('user@x')).toBeNull();
    });

    test('bare URL without token', () => {
      expect(classifyInput('https://example.com')).toBeNull();
    });
  });

  describe('classification priority', () => {
    test('cashu token takes priority over everything', () => {
      // A string that contains both a cashu token and an @ — cashu wins
      const result = classifyInput(`user@domain.com ${CASHU_A_TOKEN}`);
      expect(result?.type).toBe('cashu-token');
    });
  });
});
