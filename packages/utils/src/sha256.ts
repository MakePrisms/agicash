import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export async function computeSHA256(message: string): Promise<string> {
  return bytesToHex(sha256(utf8ToBytes(message)));
}
