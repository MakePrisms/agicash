import type { LightningAddressServiceConfig } from '@agicash/wallet-sdk/lightning-address-service';
import { getQueryClient } from '@agicash/wallet-sdk/query-client';
import { hexToBytes } from '@noble/hashes/utils';
import { agicashDbServer } from '../agicash-db/database.server';

const sparkMnemonic = process.env.LNURL_SERVER_SPARK_MNEMONIC || '';
if (!sparkMnemonic) {
  throw new Error('LNURL_SERVER_SPARK_MNEMONIC is not set');
}

const encryptionKeyHex = process.env.LNURL_SERVER_ENCRYPTION_KEY || '';
if (!encryptionKeyHex) {
  throw new Error('LNURL_SERVER_ENCRYPTION_KEY is not set');
}
const encryptionKey = hexToBytes(encryptionKeyHex);

/**
 * Builds the per-request config for the SDK's LightningAddressService from the
 * server environment: the service-role db, the LNURL_SERVER_* secrets, a
 * per-request query client, and the request origin.
 */
export function buildLightningAddressServiceConfig(
  request: Request,
  options?: { bypassAmountValidation?: boolean },
): LightningAddressServiceConfig {
  return {
    db: agicashDbServer,
    queryClient: getQueryClient(),
    baseUrl: new URL(request.url).origin,
    sparkMnemonic,
    encryptionKey,
    sparkStorageDir: '/tmp/.spark-data',
    bypassAmountValidation: options?.bypassAmountValidation ?? false,
  };
}
