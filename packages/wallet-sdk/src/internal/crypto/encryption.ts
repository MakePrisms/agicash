import { Money } from '@agicash/money';
import { hexToBytes } from '@noble/hashes/utils';
import { decode, encode } from '@stablelib/base64';
import {
  eciesDecrypt,
  eciesDecryptBatch,
  eciesEncrypt,
  eciesEncryptBatch,
} from '../lib/ecies/ecies';
import { ENCRYPTION_KEY_PATH, type KeyProvider } from './keys';

function preprocessData(obj: unknown): unknown {
  if (obj === undefined) return { __type: 'undefined' };
  if (typeof obj === 'number' && !Number.isFinite(obj)) {
    return { __type: 'number', value: obj.toString() };
  }
  if (obj === null || typeof obj !== 'object' || obj instanceof Money) {
    return obj;
  }
  if (obj instanceof Date) return { __type: 'Date', value: obj.toISOString() };
  if (Array.isArray(obj)) return obj.map(preprocessData);
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    result[key] = preprocessData(obj[key as keyof typeof obj]);
  }
  return result;
}

function serializeData(data: unknown): string {
  return JSON.stringify(preprocessData(data));
}

function deserializeData<T = unknown>(serializedData: string): T {
  return JSON.parse(serializedData, (_, value) => {
    if (value && typeof value === 'object' && '__type' in value) {
      switch (value.__type) {
        case 'Date':
          return new Date(value.value);
        case 'undefined':
          return undefined;
        case 'number':
          return Number(value.value);
        case 'Money':
          return new Money({
            amount: value.amount,
            currency: value.currency,
            unit: value.unit,
          });
      }
    }
    return value;
  }) as T;
}

function encryptToPublicKey<T = unknown>(data: T, publicKeyHex: string): string {
  const dataBytes = new TextEncoder().encode(serializeData(data));
  const encryptedBytes = eciesEncrypt(dataBytes, hexToBytes(publicKeyHex));
  return encode(encryptedBytes);
}

function encryptBatchToPublicKey<T extends readonly unknown[]>(
  data: T,
  publicKeyHex: string,
): string[] {
  const encoder = new TextEncoder();
  const dataBytes = data.map((x) =>
    encoder.encode(JSON.stringify(preprocessData(x))),
  );
  return eciesEncryptBatch(dataBytes, hexToBytes(publicKeyHex)).map((x) =>
    encode(x),
  );
}

function decryptWithPrivateKey<T = unknown>(
  encryptedData: string,
  privateKeyBytes: Uint8Array,
): T {
  const decryptedBytes = eciesDecrypt(decode(encryptedData), privateKeyBytes);
  return deserializeData<T>(new TextDecoder().decode(decryptedBytes));
}

function decryptBatchWithPrivateKey<T extends readonly unknown[]>(
  encryptedDataArray: readonly [...{ [K in keyof T]: string }],
  privateKeyBytes: Uint8Array,
): T {
  const decoded = encryptedDataArray.map((x) => decode(x));
  const decoder = new TextDecoder();
  return eciesDecryptBatch(decoded, privateKeyBytes).map((x) =>
    deserializeData(decoder.decode(x)),
  ) as unknown as T;
}

/** ECIES encrypt/decrypt bound to the user's data-encryption keypair. */
export type Encryption = {
  encrypt: <T = unknown>(data: T) => Promise<string>;
  decrypt: <T = unknown>(data: string) => Promise<T>;
  encryptBatch: <T extends readonly unknown[]>(data: T) => Promise<string[]>;
  decryptBatch: <T extends readonly unknown[]>(
    data: readonly [...{ [K in keyof T]: string }],
  ) => Promise<T>;
};

/** Build an {@link Encryption} from a derived keypair (private bytes + public hex). */
export function getEncryption(
  privateKey: Uint8Array,
  publicKeyHex: string,
): Encryption {
  return {
    encrypt: async (data) => encryptToPublicKey(data, publicKeyHex),
    decrypt: async (data) => decryptWithPrivateKey(data, privateKey),
    encryptBatch: async (data) => encryptBatchToPublicKey(data, publicKeyHex),
    decryptBatch: async (data) => decryptBatchWithPrivateKey(data, privateKey),
  };
}

/**
 * Lazily derives (once per SDK instance) the user's data-encryption keypair at
 * {@link ENCRYPTION_KEY_PATH} via the {@link KeyProvider} and exposes an
 * {@link Encryption}. Memoized — matches the web's Infinity-staleTime query;
 * lifetime is the SDK instance (a re-login uses a fresh `Sdk`).
 */
export class EncryptionService {
  private cached: Promise<Encryption> | null = null;
  constructor(private readonly keys: KeyProvider) {}

  get(): Promise<Encryption> {
    this.cached ??= this.build();
    return this.cached;
  }

  private async build(): Promise<Encryption> {
    const [privateKey, publicKeyHex] = await Promise.all([
      this.keys.getPrivateKeyBytes(ENCRYPTION_KEY_PATH),
      this.keys.getPublicKeyHex(ENCRYPTION_KEY_PATH, 'schnorr'),
    ]);
    return getEncryption(privateKey, publicKeyHex);
  }
}
