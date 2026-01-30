import { describe, expect, it } from 'bun:test';
import { decodeBolt11 } from './index';

const invoice =
  'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp';
const testnetInvoice =
  'lntb20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygshp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqfpp3x9et2e20v6pu37c5d9vax37wxq72un989qrsgqdj545axuxtnfemtpwkc45hx9d2ft7x04mt8q7y6t0k2dge9e7h8kpy9p34ytyslj3yu569aalz2xdk8xkd7ltxqld94u8h2esmsmacgpghe9k8';

// NOTE: You can confirm these values using https://lightningdecoder.com
describe('decodeBolt11', () => {
  it('should decode the invoice', () => {
    const result = decodeBolt11(invoice);
    expect(result).toEqual({
      amountMsat: 250000000,
      amountSat: 250000,
      expiryUnixMs: 1496314718000,
      network: 'bitcoin',
      description: '1 cup coffee',
      paymentHash:
        '0001020304050607080900010203040506070809000102030405060708090102',
    });
  });

  it('should decode a testnet invoice', () => {
    const result = decodeBolt11(testnetInvoice);
    expect(result).toEqual({
      amountMsat: 2000000000,
      amountSat: 2000000,
      expiryUnixMs: undefined,
      network: 'testnet',
      description: undefined,
      paymentHash:
        '0001020304050607080900010203040506070809000102030405060708090102',
    });
  });

  it('should decode an invoice with a `lightning` prefix', () => {
    const result = decodeBolt11(`lightning:${invoice}`);
    expect(result).toEqual({
      amountMsat: 250000000,
      amountSat: 250000,
      expiryUnixMs: 1496314718000,
      network: 'bitcoin',
      description: '1 cup coffee',
      paymentHash:
        '0001020304050607080900010203040506070809000102030405060708090102',
    });
  });
});
