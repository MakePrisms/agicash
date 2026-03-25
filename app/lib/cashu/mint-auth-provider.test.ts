import { describe, expect, it } from 'bun:test';
import { getMintAuthProvider } from './mint-auth-provider';

describe('getMintAuthProvider', () => {
  it('getCAT returns undefined initially', () => {
    const provider = getMintAuthProvider();
    expect(provider.getCAT()).toBeUndefined();
  });

  it('setCAT caches the token', () => {
    const provider = getMintAuthProvider();
    provider.setCAT('test-token');
    expect(provider.getCAT()).toBe('test-token');
  });

  it('setCAT(undefined) clears the cached token', () => {
    const provider = getMintAuthProvider();
    provider.setCAT('test-token');
    provider.setCAT(undefined);
    expect(provider.getCAT()).toBeUndefined();
  });

  it('getBlindAuthToken throws', () => {
    const provider = getMintAuthProvider();
    expect(
      provider.getBlindAuthToken({ method: 'POST', path: '/v1/swap' }),
    ).rejects.toThrow('Blind auth is not supported');
  });

  it('each call returns an independent provider', () => {
    const p1 = getMintAuthProvider();
    const p2 = getMintAuthProvider();
    p1.setCAT('token-1');
    expect(p2.getCAT()).toBeUndefined();
  });
});
