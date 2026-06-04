/**
 * Small crypto helpers — Slice 1 (auth + user).
 *
 * EXTRACTED (re-housed framework-free) from `app/lib/password-generator.ts` and
 * `app/lib/sha256.ts`. The only re-housing is `window.crypto` → the global `crypto`
 * (WebCrypto; available in browsers + Bun/Node ≥ 19 — the SDK's targets) and dropping
 * master's `window.getMockPassword` test hook. Used for guest-account passwords and the
 * password-reset secret hash.
 *
 * @module
 */

/** The character sets a generated password may draw from. */
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NUMBERS = '0123456789';
const SPECIAL = '!@#$%^&*()_+~';

/**
 * Generate a cryptographically-random password.
 *
 * Verbatim logic from master `generateRandomPassword` (letters + numbers + special by
 * default), re-housed off `window.crypto` onto the global `crypto.getRandomValues`.
 *
 * @param length - password length (default 24; master uses 32 for guest accounts, 20 for
 *   the reset secret).
 * @returns the generated password.
 */
export function generateRandomPassword(length = 24): string {
  const charset = LETTERS + NUMBERS + SPECIAL;
  const password: string[] = [];
  for (let i = 0; i < length; i++) {
    const randomIndex =
      crypto.getRandomValues(new Uint32Array(1))[0] % charset.length;
    password.push(charset[randomIndex]);
  }
  return password.join('');
}

/**
 * SHA-256 a string and return the lowercase hex digest.
 *
 * Verbatim from master `computeSHA256` (WebCrypto `crypto.subtle.digest`). Used to hash
 * the password-reset secret before sending it to OpenSecret.
 *
 * @param message - the input string.
 * @returns the hex-encoded SHA-256 digest.
 */
export async function computeSHA256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
