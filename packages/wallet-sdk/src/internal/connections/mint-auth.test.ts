import { describe, expect, it } from 'bun:test';
import { jwtWith } from '../test-support';
import { MintAuthTokenProvider, getMintAuthProvider } from './mint-auth';

const future = () => Math.floor(Date.now() / 1000) + 3600;

describe('MintAuthTokenProvider', () => {
  it('returns null when logged out', async () => {
    const p = new MintAuthTokenProvider(
      async () => jwtWith({ exp: future() }),
      async () => false,
    );
    expect(await p.getToken()).toBeNull();
  });

  it('fetches once and caches until near expiry', async () => {
    let calls = 0;
    const p = new MintAuthTokenProvider(
      async () => {
        calls += 1;
        return jwtWith({ exp: future() });
      },
      async () => true,
    );
    const a = await p.getToken();
    const b = await p.getToken();
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });
});

describe('getMintAuthProvider', () => {
  const tp = new MintAuthTokenProvider(
    async () => jwtWith({ exp: future() }),
    async () => true,
  );
  it('returns an AuthProvider for gift-card/offer, undefined otherwise', () => {
    expect(getMintAuthProvider('gift-card', tp)).toBeDefined();
    expect(getMintAuthProvider('offer', tp)).toBeDefined();
    expect(getMintAuthProvider('transactional', tp)).toBeUndefined();
  });
});
