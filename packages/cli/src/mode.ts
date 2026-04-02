import { CONFIG_LOCATION_HINT, getOpenSecretConfig } from './runtime-config';

export type CliMode = 'opensecret';

export function detectMode(): CliMode {
  if (process.env.AGICASH_MNEMONIC) {
    throw new Error(
      'Local mnemonic mode is not supported in v0.0.1. Use agicash auth login or agicash auth guest.',
    );
  }

  if (!getOpenSecretConfig().clientId) {
    throw new Error(
      `OpenSecret is not configured. Set OPENSECRET_CLIENT_ID in ${CONFIG_LOCATION_HINT}.`,
    );
  }

  return 'opensecret';
}
