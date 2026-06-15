import { describe, expect, it } from 'bun:test';
import { NotImplementedError } from '../errors';
import { notImplementedDomain } from './not-implemented';

type Demo = { doThing(): Promise<void> };

describe('notImplementedDomain', () => {
  it('throws NotImplementedError naming domain.method on any call', () => {
    const d = notImplementedDomain<Demo>('demo');
    expect(() => d.doThing()).toThrow(NotImplementedError);
    try {
      d.doThing();
    } catch (e) {
      expect((e as NotImplementedError).message).toBe(
        'demo.doThing() is not implemented',
      );
      expect((e as NotImplementedError).code).toBe('not_implemented');
    }
  });
  it('does not masquerade as a thenable', () => {
    const d = notImplementedDomain<Demo>('demo') as unknown as {
      then?: unknown;
    };
    expect(d.then).toBeUndefined();
  });
});
