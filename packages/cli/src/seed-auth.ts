import { schnorr } from '@noble/curves/secp256k1';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';

const ENCRYPTION_KEY_DERIVATION_PATH = "m/10111099'/0'";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function deriveEncryptionKeypair(mnemonic: string) {
  const seed = mnemonicToSeedSync(mnemonic);
  const master = HDKey.fromMasterSeed(seed);
  const child = master.derive(ENCRYPTION_KEY_DERIVATION_PATH);
  if (!child.privateKey) throw new Error('Failed to derive encryption key');

  const publicKey = schnorr.getPublicKey(child.privateKey);
  return {
    privateKey: child.privateKey,
    publicKeyHex: bytesToHex(publicKey),
  };
}

export type SeedAuthResult = {
  token: string;
  expiresAt: number;
  publicKeyHex: string;
};

/**
 * Authenticates using a seed phrase via the seed-auth edge function.
 *
 * 1. Derives encryption keypair at m/10111099'/0' from mnemonic
 * 2. Creates message: agicash:seed-auth:{pubkey}:{timestamp}
 * 3. Signs with schnorr
 * 4. POSTs to seed-auth edge function
 * 5. Returns JWT token
 */
export async function authenticateWithSeed(
  mnemonic: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<SeedAuthResult> {
  const { privateKey, publicKeyHex } = deriveEncryptionKeypair(mnemonic);

  const timestamp = Math.floor(Date.now() / 1000);
  const message = `agicash:seed-auth:${publicKeyHex}:${timestamp}`;
  const messageBytes = new TextEncoder().encode(message);
  const signature = bytesToHex(schnorr.sign(messageBytes, privateKey));

  const response = await fetch(`${supabaseUrl}/functions/v1/seed-auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({
      public_key: publicKeyHex,
      timestamp,
      signature,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      `Seed auth failed (${response.status}): ${(body as { error?: string }).error ?? 'Unknown error'}`,
    );
  }

  const body = (await response.json()) as {
    token: string;
    expires_at: number;
  };
  return {
    token: body.token,
    expiresAt: body.expires_at,
    publicKeyHex,
  };
}
