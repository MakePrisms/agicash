import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../db/database';
import { LightningAddressService } from '../receive/lightning-address-service';
import type { ServerSdk, ServerSdkConfig } from './server';

let currentInstance: AgicashServerSdk | undefined;

/** Runtime for `ServerSdkConstructor`. One instance per process until `dispose()`. */
export class AgicashServerSdk implements ServerSdk {
  readonly lightningAddress: ServerSdk['lightningAddress'];

  private constructor(config: ServerSdkConfig) {
    const db = createClient<Database>(config.db.url, config.db.serviceRoleKey, {
      db: { schema: 'wallet' },
    });
    const service = new LightningAddressService({
      db,
      spark: {
        apiKey: config.spark.breezApiKey,
        network: config.spark.network,
        mnemonic: config.spark.mnemonic,
        storageDir: config.spark.storageDir,
      },
      quoteEncryptionKey: config.quoteEncryptionKey,
    });
    this.lightningAddress = {
      handleLud16Request: (params) => service.handleLud16Request(params),
      handleLnurlpCallback: (params) => service.handleLnurlpCallback(params),
      handleLnurlpVerify: (params) => service.handleLnurlpVerify(params),
    };
  }

  /** Sync; no I/O. Throws while an undisposed instance exists. */
  static create(config: ServerSdkConfig): AgicashServerSdk {
    if (currentInstance) {
      throw new Error(
        'An AgicashServerSdk instance already exists in this process. dispose() it before creating another.',
      );
    }
    currentInstance = new AgicashServerSdk(config);
    return currentInstance;
  }

  /** Drops the process slot so a later `create` can run. Does not disconnect Breez. */
  dispose(): void {
    if (currentInstance === this) {
      currentInstance = undefined;
    }
  }
}
