type PasswordOptions = {
  letters?: boolean;
  numbers?: boolean;
  special?: boolean;
};

export function generateRandomPassword(
  length = 24,
  options: PasswordOptions = { letters: true, numbers: true, special: true },
): string {
  let charset = '';

  if (options.letters)
    charset += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (options.numbers) charset += '0123456789';
  if (options.special) charset += '!@#$%^&*()_+~';

  if (!charset) {
    throw new Error(
      'At least one character set (letters, numbers, special) must be selected.',
    );
  }

  const password: string[] = [];

  // globalThis.crypto is the Web Crypto API, present in the browser, Node >=20,
  // and Bun. There is no isomorphic import for it: node:crypto is Node-only and
  // breaks browser bundling, so the global is the portable handle.
  for (let i = 0; i < length; i++) {
    const randomIndex =
      globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % charset.length;
    password.push(charset[randomIndex]);
  }

  return password.join('');
}
