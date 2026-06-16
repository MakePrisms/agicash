import { describe, expect, it } from 'bun:test';
import { buildLightningAddressFormatValidator } from './index';

describe('buildLightningAddressFormatValidator', () => {
  const validate = buildLightningAddressFormatValidator({
    message: 'invalid',
    allowLocalhost: false,
  });

  it('accepts a well-formed lightning address', () => {
    expect(validate('alice@agi.cash')).toBe(true);
  });

  it('rejects a non-address string', () => {
    expect(validate('not-an-address')).not.toBe(true);
  });

  it('rejects localhost when allowLocalhost is false', () => {
    expect(validate('alice@localhost')).not.toBe(true);
  });

  it('accepts localhost when allowLocalhost is true', () => {
    const dev = buildLightningAddressFormatValidator({
      message: 'invalid',
      allowLocalhost: true,
    });
    expect(dev('alice@localhost')).toBe(true);
  });
});
