const CHARSET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~';

/**
 * @param length - Number of characters in the generated password (default 24)
 * @returns A cryptographically random password drawn from letters, digits, and symbols
 */
export function generateRandomPassword(length = 24): string {
  const password: string[] = [];
  for (let i = 0; i < length; i++) {
    const randomIndex =
      globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % CHARSET.length;
    password.push(CHARSET[randomIndex]);
  }
  return password.join('');
}
