interface PasswordOptions {
  letters?: boolean;
  numbers?: boolean;
  special?: boolean;
}

/**
 * Generates a cryptographically random password from the selected character
 * sets. Length defaults to 24; pass options to restrict the charset.
 *
 * @throws if all character sets are disabled.
 */
export async function generateRandomPassword(
  length = 24,
  options: PasswordOptions = { letters: true, numbers: true, special: true },
): Promise<string> {
  // e2e test seam: a fixture may expose globalThis.getMockPassword to make
  // generated passwords deterministic. window === globalThis in the browser,
  // so the Playwright `page.exposeFunction('getMockPassword', ...)` is seen
  // here.
  const getMockPassword = (
    globalThis as { getMockPassword?: () => Promise<string | null> }
  ).getMockPassword;
  if (getMockPassword) {
    const password = await getMockPassword();
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

  for (let i = 0; i < length; i++) {
    const randomIndex =
      crypto.getRandomValues(new Uint32Array(1))[0] % charset.length;
    password.push(charset[randomIndex]);
  }

  return password.join('');
}
