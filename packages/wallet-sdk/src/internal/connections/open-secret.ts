import {
  configure,
  generateThirdPartyToken,
  getPrivateKey,
  getPrivateKeyBytes,
  getPublicKey,
  type StorageProvider,
} from '@agicash/opensecret';
import { hexToBytes } from '@noble/hashes/utils';
import type { SdkConfig } from '../../config';
import type { KeyProvider } from '../crypto/keys';

/**
 * Configure the OpenSecret SDK from {@link SdkConfig}. Must be called once
 * before any other OpenSecret usage (the SDK owns this; consumers never call
 * `configure` directly). Idempotency is the caller's concern.
 */
export function configureOpenSecret(config: SdkConfig): void {
  configure({
    apiUrl: config.openSecret.url,
    clientId: config.openSecret.clientId,
    storage: config.storage,
  });
}

/**
 * Whether a user session is active, read from the SDK's configured storage —
 * framework-free (no `window`/`localStorage`), so it works in the browser and
 * in Node/MCP. `isLoggedIn` is not exported by the opensecret rc; the rc
 * persists `access_token`/`refresh_token` in `storage.persistent`, so the
 * session is active iff both exist and the refresh token has not expired.
 */
export async function isLoggedIn(storage: StorageProvider): Promise<boolean> {
  const [accessToken, refreshToken] = await Promise.all([
    storage.persistent.getItem('access_token'),
    storage.persistent.getItem('refresh_token'),
  ]);
  if (!accessToken || !refreshToken) {
    return false;
  }
  const exp = decodeJwtExp(refreshToken);
  return exp !== undefined && exp * 1000 > Date.now();
}

/** Extract a JWT's `exp` (epoch seconds) from its base64url payload, no deps. */
function decodeJwtExp(jwt: string): number | undefined {
  const segment = jwt.split('.')[1];
  if (!segment) {
    return undefined;
  }
  try {
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
    const { exp } = JSON.parse(atob(padded)) as { exp?: number };
    return exp;
  } catch {
    return undefined;
  }
}

/** Re-exported session primitives used by the SDK's Supabase session wiring. */
export { generateThirdPartyToken };

/** A {@link KeyProvider} backed by the OpenSecret enclave key APIs. */
export function openSecretKeyProvider(): KeyProvider {
  return {
    getChildMnemonic: async (path) =>
      (await getPrivateKey({ seed_phrase_derivation_path: path })).mnemonic,
    getPrivateKeyBytes: async (path) =>
      hexToBytes(
        (await getPrivateKeyBytes({ private_key_derivation_path: path }))
          .private_key,
      ),
    getPublicKeyHex: async (path, algorithm) =>
      (await getPublicKey(algorithm, { private_key_derivation_path: path }))
        .public_key,
  };
}
