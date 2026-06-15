import { describe, expect, it } from 'bun:test';
import {
  CASHU_MNEMONIC_PATH,
  ENCRYPTION_KEY_PATH,
  SPARK_MNEMONIC_PATH,
} from './keys';

describe('derivation path constants', () => {
  it('CASHU_MNEMONIC_PATH equals the BIP-85 cashu path', () => {
    expect(CASHU_MNEMONIC_PATH).toBe("m/83696968'/39'/0'/12'/0'");
  });

  it('SPARK_MNEMONIC_PATH equals the BIP-85 spark path', () => {
    expect(SPARK_MNEMONIC_PATH).toBe("m/83696968'/39'/0'/12'/1'");
  });

  it('ENCRYPTION_KEY_PATH equals the BIP-32 encryption path', () => {
    expect(ENCRYPTION_KEY_PATH).toBe("m/10111099'/0'");
  });
});
