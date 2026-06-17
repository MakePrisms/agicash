import { describe, expect, test } from 'bun:test';
import { classifyMintQuoteUpdate } from './mint-quote-classification';

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();

describe('classifyMintQuoteUpdate', () => {
  test('UNPAID + expired → expired', () => {
    expect(classifyMintQuoteUpdate('UNPAID', past)).toBe('expired');
  });
  test('UNPAID + not expired → none', () => {
    expect(classifyMintQuoteUpdate('UNPAID', future)).toBeUndefined();
  });
  test('PAID → paid', () => {
    expect(classifyMintQuoteUpdate('PAID', future)).toBe('paid');
  });
  test('ISSUED → issued (re-complete after a crash post-mint)', () => {
    expect(classifyMintQuoteUpdate('ISSUED', future)).toBe('issued');
  });
  test('PENDING / other → none', () => {
    expect(classifyMintQuoteUpdate('PENDING', future)).toBeUndefined();
  });
  test('mint EXPIRED → none (expiry is driven by the receive quote, not mint state)', () => {
    expect(classifyMintQuoteUpdate('EXPIRED', past)).toBeUndefined();
  });
});
