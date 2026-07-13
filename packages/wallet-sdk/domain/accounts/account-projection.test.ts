import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import type {
  CashuAccount as DomainCashuAccount,
  SparkAccount as DomainSparkAccount,
} from './account';
import {
  MissingDomainFieldsError,
  toAccountProjection,
  toDomainAccount,
} from './account-projection';

const cashuDomain = {
  id: 'acct-cashu',
  name: 'Testnut BTC',
  type: 'cashu',
  purpose: 'transactional',
  state: 'active',
  isOnline: true,
  currency: 'BTC',
  createdAt: '2026-01-01T00:00:00Z',
  version: 1,
  expiresAt: null,
  mintUrl: 'https://testnut.cashu.space',
  isTestMint: true,
  keysetCounters: { ks1: 3 },
  proofs: [{ amount: 100 }, { amount: 50 }],
  wallet: { marker: 'cashu-wallet' },
} as unknown as DomainCashuAccount;

const sparkDomain = {
  id: 'acct-spark',
  name: 'Bitcoin',
  type: 'spark',
  purpose: 'transactional',
  state: 'active',
  isOnline: true,
  currency: 'BTC',
  createdAt: '2026-01-01T00:00:00Z',
  version: 1,
  expiresAt: null,
  network: 'MAINNET',
  balance: new Money({ amount: 42, currency: 'BTC', unit: 'sat' }),
  wallet: { marker: 'spark-wallet' },
} as unknown as DomainSparkAccount;

describe('toAccountProjection', () => {
  it('attaches the cashu balance computed from the proofs', () => {
    const projection = toAccountProjection(cashuDomain);
    expect(projection.balance?.amount('sat').toNumber()).toBe(150);
  });

  it('passes the spark balance through unchanged', () => {
    const projection = toAccountProjection(sparkDomain);
    expect(projection.balance).toBe(sparkDomain.balance);
  });

  it('keeps the hidden domain fields on a cashu projection at runtime while stripping them at the type level', () => {
    const projection = toAccountProjection(cashuDomain);
    // @ts-expect-error - proofs is stripped from the public projection type
    expect(projection.proofs).toBe(cashuDomain.proofs);
    // @ts-expect-error - wallet is stripped from the public projection type
    expect(projection.wallet).toBe(cashuDomain.wallet);
    // @ts-expect-error - keysetCounters is stripped from the public projection type
    expect(projection.keysetCounters).toBe(cashuDomain.keysetCounters);
  });

  it('keeps the hidden wallet on a spark projection at runtime while stripping it at the type level', () => {
    const projection = toAccountProjection(sparkDomain);
    // @ts-expect-error - wallet is stripped from the public projection type
    expect(projection.wallet).toBe(sparkDomain.wallet);
  });
});

type ProjectionAccount = Parameters<typeof toDomainAccount>[0];

const thinCashuProjection = {
  id: 'acct-cashu',
  name: 'Testnut BTC',
  type: 'cashu',
  purpose: 'transactional',
  state: 'active',
  isOnline: true,
  currency: 'BTC',
  createdAt: '2026-01-01T00:00:00Z',
  version: 1,
  expiresAt: null,
  mintUrl: 'https://testnut.cashu.space',
  isTestMint: true,
  balance: null,
} as unknown as ProjectionAccount;

const thinSparkProjection = {
  id: 'acct-spark',
  name: 'Bitcoin',
  type: 'spark',
  purpose: 'transactional',
  state: 'active',
  isOnline: true,
  currency: 'BTC',
  createdAt: '2026-01-01T00:00:00Z',
  version: 1,
  expiresAt: null,
  network: 'MAINNET',
  balance: null,
} as unknown as ProjectionAccount;

describe('toDomainAccount', () => {
  it('unwraps a runtime-fat cashu projection back to the domain account', () => {
    const projection = toAccountProjection(cashuDomain);
    const domain = toDomainAccount(projection);
    expect(Object.is(domain, projection)).toBe(true);
    expect(domain.type === 'cashu' && domain.proofs).toBe(cashuDomain.proofs);
  });

  it('unwraps a runtime-fat spark projection back to the domain account', () => {
    const projection = toAccountProjection(sparkDomain);
    const domain = toDomainAccount(projection);
    expect(domain.type === 'spark' && domain.wallet).toBe(sparkDomain.wallet);
  });

  it('throws a typed error naming every missing field for a thin cashu object', () => {
    expect(() => toDomainAccount(thinCashuProjection)).toThrow(
      MissingDomainFieldsError,
    );
    expect(() => toDomainAccount(thinCashuProjection)).toThrow(
      /proofs, wallet, keysetCounters/,
    );
  });

  it('throws naming the missing wallet for a thin spark object', () => {
    expect(() => toDomainAccount(thinSparkProjection)).toThrow(
      MissingDomainFieldsError,
    );
    expect(() => toDomainAccount(thinSparkProjection)).toThrow(/wallet/);
  });
});
