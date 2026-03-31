import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export async function computeSHA256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  return bytesToHex(sha256(data));
}
