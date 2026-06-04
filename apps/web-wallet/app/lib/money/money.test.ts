import { describe, expect, it } from 'bun:test';
import { Big } from 'big.js';
import { Money } from '.';

describe('Money', () => {
  describe('USD', () => {
    it('handles basic dollar amounts', () => {
      const money = new Money({ amount: 1000, currency: 'USD' });
      expect(money.amount().toString()).toBe('1000');
      expect(money.toString()).toBe('1000.00');
      expect(money.toLocaleString()).toBe('$1,000.00');
    });

    it('handles cents', () => {
      const money = new Money({ amount: 50, currency: 'USD', unit: 'cent' });
      expect(money.amount().toString()).toBe('0.5');
      expect(money.amount('cent').toString()).toBe('50');
      expect(money.toString('cent')).toBe('50');
      expect(money.toLocaleString({ unit: 'cent' })).toBe('50¢');

      // Same amount created in dollars
      const moneyInDollars = new Money({ amount: 0.5, currency: 'USD' });
      expect(moneyInDollars.amount('cent').toString()).toBe('50');
      expect(moneyInDollars.toLocaleString({ unit: 'cent' })).toBe('50¢');
    });

    it('handles fractional cents', () => {
      const money = new Money({ amount: 0.0123, currency: 'USD' });
      expect(money.amount().toString()).toBe('0.01');
      expect(money.toString()).toBe('0.01');
      expect(money.toLocaleString()).toBe('$0.01');
    });
  });

  describe('BTC', () => {
    it('handles basic bitcoin amounts', () => {
      const money = new Money({ amount: 1.23456789, currency: 'BTC' });
      expect(money.amount().toString()).toBe('1.23456789');
      expect(money.toString()).toBe('1.23456789');
      expect(money.toLocaleString()).toBe('₿1.23456789');
    });

    it('handles satoshis', () => {
      const money = new Money({ amount: 123456, currency: 'BTC', unit: 'sat' });
      expect(money.amount().toString()).toBe('0.00123456');
      expect(money.amount('sat').toString()).toBe('123456');
      expect(money.toString('sat')).toBe('123456');
      expect(money.toLocaleString({ unit: 'sat' })).toBe('₿123,456');

      // Same amount created in bitcoin
      const moneyInBtc = new Money({ amount: 0.00123456, currency: 'BTC' });
      expect(moneyInBtc.amount('sat').toString()).toBe('123456');
      expect(moneyInBtc.toLocaleString({ unit: 'sat' })).toBe('₿123,456');
    });

    it('handles millisatoshis', () => {
      const money = new Money({
        amount: 123456789,
        currency: 'BTC',
        unit: 'msat',
      });
      expect(money.amount().toString()).toBe('0.00123456');
      expect(money.amount('msat').toString()).toBe('123456789');
      expect(money.toString('msat')).toBe('123456789');
      expect(money.toLocaleString({ unit: 'msat' })).toBe('123,456,789 msat');

      // Same amount created in bitcoin
      const moneyInBtc = new Money({ amount: 0.00123456, currency: 'BTC' });
      expect(moneyInBtc.amount('msat').toString()).toBe('123456000');
      expect(moneyInBtc.toLocaleString({ unit: 'msat' })).toBe(
        '123,456,000 msat',
      );

      // Same amount created in satoshis
      const moneyInSat = new Money({
        amount: 123456,
        currency: 'BTC',
        unit: 'sat',
      });
      expect(moneyInSat.amount('msat').toString()).toBe('123456000');
      expect(moneyInSat.toLocaleString({ unit: 'msat' })).toBe(
        '123,456,000 msat',
      );
    });
  });

  describe('toLocaleString', () => {
    it('handles other locales for USD', () => {
      const money = new Money({ amount: 1000, currency: 'USD' });
      expect(money.toLocaleString({ locale: 'fr-FR', unit: 'cent' })).toBe(
        '100 000¢',
      );
      expect(money.toLocaleString({ locale: 'de-DE', unit: 'cent' })).toBe(
        '100.000¢',
      );
    });

    it('handles other locales for BTC', () => {
      const money = new Money({ amount: 1.23456789, currency: 'BTC' });
      expect(money.toLocaleString({ locale: 'fr-FR' })).toBe('₿1,23456789');
      expect(money.toLocaleString({ locale: 'de-DE' })).toBe('₿1,23456789');
    });
  });

  describe('conversion', () => {
    it('converts between currencies', () => {
      const usd = new Money({ amount: 50000, currency: 'USD' });
      const rate = new Big(1).div(50000); // 1 BTC = $50,000
      const btc = usd.convert('BTC', rate);

      expect(btc.amount().toString()).toBe('1');
      expect(btc.currency).toBe('BTC');
    });

    it('maintains precision during conversion', () => {
      const btc = new Money({ amount: 0.00001234, currency: 'BTC' });
      const rate = new Big(50000); // 1 BTC = $50,000
      const usd = btc.convert('USD', rate);

      expect(usd.amount().toString()).toBe('0.62');
      expect(usd.currency).toBe('USD');
    });
  });

  describe('arithmetic', () => {
    it('adds money of same currency', () => {
      const a = new Money({ amount: 100, currency: 'USD' });
      const b = new Money({ amount: 200, currency: 'USD' });
      const sum = a.add(b);
      expect(sum.amount().toString()).toBe('300');
    });

    it('subtracts money of same currency', () => {
      const a = new Money({ amount: 300, currency: 'USD' });
      const b = new Money({ amount: 100, currency: 'USD' });
      const diff = a.subtract(b);
      expect(diff.amount().toString()).toBe('200');
    });

    it('multiplies by a factor', () => {
      const money = new Money({ amount: 100, currency: 'USD' });
      const result = money.multiply(1.5);
      expect(result.amount().toString()).toBe('150');
    });

    it('divides by a factor', () => {
      const money = new Money({ amount: 100, currency: 'USD' });
      const result = money.divide(2);
      expect(result.amount().toString()).toBe('50');
    });
  });
});
