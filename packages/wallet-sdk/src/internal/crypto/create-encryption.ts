import type { KeyService } from '../keys';
import { type Encryption, getEncryption } from './encryption';

/**
 * Builds an Encryption backed by the in-memory KeyService keys. Each method
 * awaits the (cached) encryption keypair before delegating to the pure ECIES
 * functions, so the first use derives and subsequent uses pay only the cache hit.
 */
export function createEncryption(keys: KeyService): Encryption {
  const resolve = async () =>
    getEncryption(
      await keys.getEncryptionPrivateKey(),
      await keys.getEncryptionPublicKey(),
    );
  return {
    encrypt: async <T>(data: T) => (await resolve()).encrypt(data),
    decrypt: async <T>(data: string) => (await resolve()).decrypt<T>(data),
    encryptBatch: async <T extends readonly unknown[]>(data: T) =>
      (await resolve()).encryptBatch(data),
    decryptBatch: async <T extends readonly unknown[]>(
      data: readonly [...{ [K in keyof T]: string }],
    ) => (await resolve()).decryptBatch<T>(data),
  };
}
