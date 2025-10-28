interface PasswordOptions {
  letters?: boolean;
  numbers?: boolean;
  special?: boolean;
}

export async function generateRandomPassword(
  length = 24,
  options: PasswordOptions = { letters: true, numbers: true, special: true },
): Promise<string> {
  if (typeof window !== 'undefined' && window.getMockPassword) {
    const password = await window.getMockPassword();
    if (password) {
      return password;
    }
  }

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

  const crypto = globalThis.crypto;

  for (let i = 0; i < length; i++) {
    const randomIndex =
      crypto.getRandomValues(new Uint32Array(1))[0] % charset.length;
    password.push(charset[randomIndex]);
  }

  return password.join('');
}
