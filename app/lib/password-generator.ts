interface PasswordOptions {
  letters?: boolean;
  numbers?: boolean;
  special?: boolean;
}

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

  for (let i = 0; i < length; i++) {
    const randomIndex =
      window.crypto.getRandomValues(new Uint32Array(1))[0] % charset.length;
    password.push(charset[randomIndex]);
  }

  return password.join('');
}
