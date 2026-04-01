export type CliMode = 'opensecret' | 'local';

export function detectMode(): CliMode {
  const hasOpenSecret = Boolean(process.env.OPENSECRET_CLIENT_ID);
  const hasMnemonic = Boolean(process.env.AGICASH_MNEMONIC);

  if (hasOpenSecret && hasMnemonic) {
    throw new Error(
      'Ambiguous config: set OPENSECRET_CLIENT_ID or AGICASH_MNEMONIC, not both',
    );
  }

  if (!hasOpenSecret && !hasMnemonic) {
    throw new Error(
      'No wallet configured. Set OPENSECRET_CLIENT_ID (cloud) or AGICASH_MNEMONIC (local) in .env',
    );
  }

  return hasOpenSecret ? 'opensecret' : 'local';
}
