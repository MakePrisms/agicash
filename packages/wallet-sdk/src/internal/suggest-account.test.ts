import { describe, expect, test } from 'bun:test';
import { suggestAccountFor } from './suggest-account';
import type { Account, CashuAccount, SparkAccount } from '../types/account';
import { type Currency, Money } from '../types/money';
import type { ParsedDestination, PaymentIntent } from '../types/scan';

// -- Test builders -----------------------------------------------------------

/**
 * Build a cashu test account. `sats` sets the balance via a single synthetic proof (the
 * suggester reads balance through `getAccountBalance` → `sumProofs`, so one proof of `sats`
 * is enough). `wallet`/`proofs` internals are cast — the pure suggester never touches them.
 */
function cashuAccount(opts: {
  id: string;
  sats: number;
  isOnline?: boolean;
  currency?: 'BTC' | 'USD';
  purpose?: Account['purpose'];
  createdAt?: string;
}): CashuAccount {
  return {
    id: opts.id,
    name: opts.id,
    type: 'cashu',
    purpose: opts.purpose ?? 'transactional',
    state: 'active',
    isOnline: opts.isOnline ?? true,
    currency: opts.currency ?? 'BTC',
    createdAt: opts.createdAt ?? '2026-01-01T00:00:00.000Z',
    version: 1,
    expiresAt: null,
    mintUrl: `https://mint-${opts.id}.example.com`,
    isTestMint: false,
    keysetCounters: {},
    proofs:
      opts.sats > 0
        ? ([{ amount: opts.sats }] as unknown as CashuAccount['proofs'])
        : [],
    wallet: {} as never,
  };
}

/** Build a spark test account whose balance is `sats` (or null when omitted). */
function sparkAccount(opts: {
  id: string;
  sats: number | null;
  isOnline?: boolean;
  currency?: 'BTC' | 'USD';
  createdAt?: string;
}): SparkAccount {
  const currency = opts.currency ?? 'BTC';
  return {
    id: opts.id,
    name: opts.id,
    type: 'spark',
    purpose: 'transactional',
    state: 'active',
    isOnline: opts.isOnline ?? true,
    currency,
    createdAt: opts.createdAt ?? '2026-01-01T00:00:00.000Z',
    version: 1,
    expiresAt: null,
    balance:
      opts.sats === null
        ? null
        : new Money({ amount: opts.sats, currency, unit: 'sat' }),
    network: 'MAINNET',
    wallet: {} as never,
  };
}

const bolt11Destination: ParsedDestination = {
  kind: 'bolt11',
  invoice: {
    amountMsat: undefined,
    amountSat: undefined,
    createdAtUnixMs: 0,
    expiryUnixMs: 0,
    network: 'bitcoin',
    description: undefined,
    payeeNodeKey: '00'.repeat(33),
    paymentHash: 'deadbeef',
  },
};

const sendSats = (sats: number): PaymentIntent => ({
  kind: 'send',
  destination: bolt11Destination,
  amount: new Money<Currency>({ amount: sats, currency: 'BTC', unit: 'sat' }),
});

describe('suggestAccountFor', () => {
  test('throws when there are no accounts', () => {
    expect(() => suggestAccountFor(sendSats(100), [])).toThrow(
      'No accounts to choose from',
    );
  });

  describe('online filter', () => {
    test('offline accounts are excluded from recommended/alternatives', () => {
      const online = cashuAccount({ id: 'on', sats: 1000 });
      const offline = cashuAccount({ id: 'off', sats: 1000, isOnline: false });
      const result = suggestAccountFor(sendSats(100), [offline, online]);
      expect(result.recommended.id).toBe('on');
      expect(result.alternatives).toHaveLength(0);
      // The offline account is not surfaced as insufficient either (it was filtered out).
      expect(result.insufficient).toHaveLength(0);
    });

    test('throws when the only account is offline (no candidate)', () => {
      const offline = cashuAccount({ id: 'off', sats: 1000, isOnline: false });
      expect(() => suggestAccountFor(sendSats(100), [offline])).toThrow(
        'No account matches the payment intent',
      );
    });
  });

  describe('currency filter (BTC for a Lightning send)', () => {
    test('USD accounts are excluded for a bolt11 send', () => {
      const usd = cashuAccount({ id: 'usd', sats: 5000, currency: 'USD' });
      const btc = cashuAccount({ id: 'btc', sats: 5000, currency: 'BTC' });
      const result = suggestAccountFor(sendSats(100), [usd, btc]);
      expect(result.recommended.id).toBe('btc');
      expect(result.recommended.currency).toBe('BTC');
    });
  });

  describe('balance split', () => {
    test('partitions accounts into sufficient vs insufficient', () => {
      const rich = cashuAccount({ id: 'rich', sats: 5000 });
      const poor = cashuAccount({ id: 'poor', sats: 50 });
      const result = suggestAccountFor(sendSats(1000), [rich, poor]);
      expect(result.recommended.id).toBe('rich');
      expect(result.insufficient.map((a) => a.id)).toEqual(['poor']);
    });

    test('amountless send needs only a positive balance', () => {
      const positive = cashuAccount({ id: 'pos', sats: 1 });
      const empty = cashuAccount({ id: 'empty', sats: 0 });
      const intent: PaymentIntent = {
        kind: 'send',
        destination: bolt11Destination,
      };
      const result = suggestAccountFor(intent, [empty, positive]);
      expect(result.recommended.id).toBe('pos');
      expect(result.insufficient.map((a) => a.id)).toEqual(['empty']);
    });
  });

  describe('ranking (cheap-first, no cross-protocol cost comparison)', () => {
    test('prefers a higher-priority purpose (offer > gift-card > transactional)', () => {
      const txn = cashuAccount({ id: 'txn', sats: 5000 });
      const card = cashuAccount({
        id: 'card',
        sats: 5000,
        purpose: 'gift-card',
      });
      const offer = cashuAccount({ id: 'offer', sats: 5000, purpose: 'offer' });
      const result = suggestAccountFor(sendSats(100), [txn, card, offer]);
      expect(result.recommended.id).toBe('offer');
      expect(result.reason).toBe('offer-account match');
      // Remaining sufficient accounts ranked after, by the same comparator.
      expect(result.alternatives.map((a) => a.id)).toEqual(['card', 'txn']);
    });

    test('within the same purpose, prefers the higher balance', () => {
      const small = cashuAccount({ id: 'small', sats: 2000 });
      const big = cashuAccount({ id: 'big', sats: 9000 });
      const result = suggestAccountFor(sendSats(100), [small, big]);
      expect(result.recommended.id).toBe('big');
      expect(result.alternatives.map((a) => a.id)).toEqual(['small']);
    });

    test('ties broken by creation date (older first)', () => {
      const newer = cashuAccount({
        id: 'newer',
        sats: 5000,
        createdAt: '2026-02-01T00:00:00.000Z',
      });
      const older = cashuAccount({
        id: 'older',
        sats: 5000,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      const result = suggestAccountFor(sendSats(100), [newer, older]);
      expect(result.recommended.id).toBe('older');
    });

    test('mixes cashu + spark by balance (no protocol preference)', () => {
      const cashu = cashuAccount({ id: 'cashu', sats: 3000 });
      const spark = sparkAccount({ id: 'spark', sats: 8000 });
      const result = suggestAccountFor(sendSats(100), [cashu, spark]);
      expect(result.recommended.id).toBe('spark');
    });
  });

  describe('default fallback (nothing has sufficient balance)', () => {
    test('falls back to the user default account id when provided', () => {
      const a = cashuAccount({ id: 'a', sats: 10 });
      const b = cashuAccount({ id: 'b', sats: 20 });
      const result = suggestAccountFor(sendSats(5000), [a, b], 'b');
      expect(result.recommended.id).toBe('b');
      expect(result.alternatives).toHaveLength(0);
      expect(result.insufficient.map((x) => x.id)).toEqual(['a']);
      expect(result.reason).toBe('insufficient balance; default account');
    });

    test('falls back to the first insufficient account when no default id given', () => {
      const a = cashuAccount({ id: 'a', sats: 10 });
      const b = cashuAccount({ id: 'b', sats: 20 });
      const result = suggestAccountFor(sendSats(5000), [a, b]);
      expect(result.recommended.id).toBe('a');
      expect(result.insufficient.map((x) => x.id)).toEqual(['b']);
    });
  });

  describe('receive intents', () => {
    test('receive does not require balance (any online account qualifies)', () => {
      const empty = cashuAccount({ id: 'empty', sats: 0 });
      const intent: PaymentIntent = {
        kind: 'receive',
        amount: new Money<Currency>({
          amount: 1000,
          currency: 'BTC',
          unit: 'sat',
        }),
      };
      const result = suggestAccountFor(intent, [empty]);
      expect(result.recommended.id).toBe('empty');
      expect(result.insufficient).toHaveLength(0);
      expect(result.reason).toContain('receive');
    });

    test('token-receive does not constrain currency or balance', () => {
      const usdEmpty = cashuAccount({
        id: 'usd',
        sats: 0,
        currency: 'USD',
      });
      const intent: PaymentIntent = {
        kind: 'token-receive',
        token: 'cashuAfoo',
      };
      const result = suggestAccountFor(intent, [usdEmpty]);
      expect(result.recommended.id).toBe('usd');
    });

    test('receive still applies the online filter', () => {
      const offline = cashuAccount({ id: 'off', sats: 0, isOnline: false });
      const online = cashuAccount({ id: 'on', sats: 0 });
      const intent: PaymentIntent = { kind: 'receive' };
      const result = suggestAccountFor(intent, [offline, online]);
      expect(result.recommended.id).toBe('on');
    });
  });
});
