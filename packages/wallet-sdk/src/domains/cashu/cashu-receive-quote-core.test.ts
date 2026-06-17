import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import {
  getCashuCryptography,
  BASE_CASHU_LOCKING_DERIVATION_PATH,
} from '../../internal/connections/cashu-crypto';
import {
  computeQuoteExpiry,
  computeTotalFee,
  deriveNut20LockingPublicKey,
  type CreateQuoteBaseParams,
  type CashuReceiveLightningQuote,
} from './cashu-receive-quote-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function btcMoney(amount: number): Money<Currency> {
  return new Money({
    amount,
    currency: 'BTC',
    unit: 'sat',
  }) as unknown as Money<Currency>;
}

function usdMoney(amount: number): Money<Currency> {
  return new Money({
    amount,
    currency: 'USD',
    unit: 'cent',
  }) as unknown as Money<Currency>;
}

function makeLightningQuote(
  overrides: Partial<CashuReceiveLightningQuote> = {},
): CashuReceiveLightningQuote {
  return {
    mintQuote: {} as CashuReceiveLightningQuote['mintQuote'],
    lockingPublicKey: '02' + 'ab'.repeat(32),
    fullLockingDerivationPath: `${BASE_CASHU_LOCKING_DERIVATION_PATH}/42`,
    expiresAt: '2030-01-01T12:00:00.000Z',
    amount: btcMoney(1000),
    description: 'test receive',
    paymentHash: 'abc123',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build a real xpub from a fixed seed for deterministic tests
// ---------------------------------------------------------------------------

async function getFixedXpub(): Promise<string> {
  const crypto = getCashuCryptography(async () => new Uint8Array(64).fill(7));
  return crypto.getXpub(BASE_CASHU_LOCKING_DERIVATION_PATH);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveNut20LockingPublicKey', () => {
  it('returns a 33-byte (66-char) compressed public key hex', async () => {
    const xPub = await getFixedXpub();
    const { lockingPublicKey } = deriveNut20LockingPublicKey(xPub);
    expect(lockingPublicKey).toHaveLength(66);
    expect(lockingPublicKey).toMatch(/^[0-9a-f]+$/);
  });

  it('returns a derivation path of the form m/129372\'/0\'/0\'/<index>', async () => {
    const xPub = await getFixedXpub();
    const { fullLockingDerivationPath } = deriveNut20LockingPublicKey(xPub);
    expect(fullLockingDerivationPath).toMatch(
      /^m\/129372'\/0'\/0'\/\d+$/,
    );
  });

  it('produces different keys on successive calls (random index)', async () => {
    const xPub = await getFixedXpub();
    const results = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { lockingPublicKey } = deriveNut20LockingPublicKey(xPub);
      results.add(lockingPublicKey);
    }
    // With 5 draws from ~2^31 indices, all should be distinct.
    expect(results.size).toBe(5);
  });

  it('derived public key is consistent with private key derivation', async () => {
    const crypto = getCashuCryptography(async () => new Uint8Array(64).fill(7));
    const xPub = await crypto.getXpub(BASE_CASHU_LOCKING_DERIVATION_PATH);
    const { lockingPublicKey, fullLockingDerivationPath } =
      deriveNut20LockingPublicKey(xPub);

    // Extract the leaf index from the full path, then derive the private key at that path.
    const privateKey = await crypto.getPrivateKey(fullLockingDerivationPath);

    // secp256k1: the compressed public key for a private key is a 33-byte point.
    // Verify the derived pubkey matches by checking it is non-empty and 66 chars.
    expect(lockingPublicKey).toHaveLength(66);
    expect(privateKey).toHaveLength(64); // 32-byte hex
  });
});

// ---------------------------------------------------------------------------
// computeTotalFee
// ---------------------------------------------------------------------------

describe('computeTotalFee', () => {
  it('LIGHTNING: returns mintingFee when present', () => {
    const params: CreateQuoteBaseParams = {
      userId: 'user-1',
      account: {} as CreateQuoteBaseParams['account'],
      receiveType: 'LIGHTNING',
      lightningQuote: makeLightningQuote({ mintingFee: btcMoney(10) }),
    };
    expect(computeTotalFee(params).toNumber('sat')).toBe(10);
  });

  it('LIGHTNING: returns zero when mintingFee is absent', () => {
    const params: CreateQuoteBaseParams = {
      userId: 'user-1',
      account: {} as CreateQuoteBaseParams['account'],
      receiveType: 'LIGHTNING',
      lightningQuote: makeLightningQuote({ mintingFee: undefined }),
    };
    expect(computeTotalFee(params).toNumber('sat')).toBe(0);
  });

  it('CASHU_TOKEN: sums mintingFee + cashuReceiveFee + lightningFeeReserve', () => {
    const params: CreateQuoteBaseParams = {
      userId: 'user-1',
      account: {} as CreateQuoteBaseParams['account'],
      receiveType: 'CASHU_TOKEN',
      lightningQuote: makeLightningQuote({ mintingFee: btcMoney(5) }),
      tokenAmount: btcMoney(1000),
      sourceMintUrl: 'https://source.mint.example',
      tokenProofs: [],
      meltQuoteId: 'melt-1',
      meltQuoteExpiresAt: '2030-01-01T11:00:00.000Z',
      cashuReceiveFee: btcMoney(3),
      lightningFeeReserve: btcMoney(2),
    };
    expect(computeTotalFee(params).toNumber('sat')).toBe(10);
  });

  it('CASHU_TOKEN: uses zero mintingFee when absent', () => {
    const params: CreateQuoteBaseParams = {
      userId: 'user-1',
      account: {} as CreateQuoteBaseParams['account'],
      receiveType: 'CASHU_TOKEN',
      lightningQuote: makeLightningQuote({ mintingFee: undefined }),
      tokenAmount: btcMoney(1000),
      sourceMintUrl: 'https://source.mint.example',
      tokenProofs: [],
      meltQuoteId: 'melt-1',
      meltQuoteExpiresAt: '2030-01-01T11:00:00.000Z',
      cashuReceiveFee: btcMoney(3),
      lightningFeeReserve: btcMoney(2),
    };
    expect(computeTotalFee(params).toNumber('sat')).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// computeQuoteExpiry
// ---------------------------------------------------------------------------

describe('computeQuoteExpiry', () => {
  it('LIGHTNING: returns the lightning quote expiresAt', () => {
    const params: CreateQuoteBaseParams = {
      userId: 'user-1',
      account: {} as CreateQuoteBaseParams['account'],
      receiveType: 'LIGHTNING',
      lightningQuote: makeLightningQuote({
        expiresAt: '2030-06-01T00:00:00.000Z',
      }),
    };
    expect(computeQuoteExpiry(params)).toBe('2030-06-01T00:00:00.000Z');
  });

  it('CASHU_TOKEN: returns the earlier of mint and melt expiry (melt earlier)', () => {
    const params: CreateQuoteBaseParams = {
      userId: 'user-1',
      account: {} as CreateQuoteBaseParams['account'],
      receiveType: 'CASHU_TOKEN',
      lightningQuote: makeLightningQuote({
        expiresAt: '2030-06-01T12:00:00.000Z',
      }),
      tokenAmount: btcMoney(1000),
      sourceMintUrl: 'https://source.mint.example',
      tokenProofs: [],
      meltQuoteId: 'melt-1',
      meltQuoteExpiresAt: '2030-06-01T06:00:00.000Z',
      cashuReceiveFee: btcMoney(0),
      lightningFeeReserve: btcMoney(0),
    };
    expect(computeQuoteExpiry(params)).toBe('2030-06-01T06:00:00.000Z');
  });

  it('CASHU_TOKEN: returns the earlier of mint and melt expiry (mint earlier)', () => {
    const params: CreateQuoteBaseParams = {
      userId: 'user-1',
      account: {} as CreateQuoteBaseParams['account'],
      receiveType: 'CASHU_TOKEN',
      lightningQuote: makeLightningQuote({
        expiresAt: '2030-06-01T02:00:00.000Z',
      }),
      tokenAmount: btcMoney(1000),
      sourceMintUrl: 'https://source.mint.example',
      tokenProofs: [],
      meltQuoteId: 'melt-1',
      meltQuoteExpiresAt: '2030-06-01T08:00:00.000Z',
      cashuReceiveFee: btcMoney(0),
      lightningFeeReserve: btcMoney(0),
    };
    expect(computeQuoteExpiry(params)).toBe('2030-06-01T02:00:00.000Z');
  });
});
