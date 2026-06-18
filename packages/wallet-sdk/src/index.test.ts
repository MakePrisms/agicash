import { describe, expect, it } from 'bun:test';
import * as sdk from './index';

describe('public barrel — server surface', () => {
  it('re-exports createServer', () => {
    expect(typeof sdk.createServer).toBe('function');
  });
});
