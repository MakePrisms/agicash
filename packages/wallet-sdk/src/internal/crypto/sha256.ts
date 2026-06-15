/**
 * @param message - UTF-8 string to hash
 * @returns Lowercase hex-encoded SHA-256 digest
 */
export async function sha256Hex(message: string): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
