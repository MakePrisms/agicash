// tools/spark-usdb-preflight.ts
//
// One-off pre-flight check for the Spark USD account work.
// 1. Determines what `account_number` the SDK treats as the default
//    (the value existing BTC users are implicitly on).
// 2. Sanity-checks USDB token metadata is reachable on mainnet.
//
// Usage:
//   PATH=<node-bin>:$PATH node --env-file=.env --import tsx tools/spark-usdb-preflight.ts
//   (bun cannot load the SDK's nodejs entry — better-sqlite3 unsupported)
//
// Requires VITE_BREEZ_API_KEY in env; uses a throwaway mnemonic.
//
// API notes — divergences from the plan's snippet (necessary, all verified
// against @agicash/breez-sdk-spark@0.13.5-1 .d.ts):
// - `generateMnemonic` is not exported by the SDK; we use @scure/bip39.
// - GetInfoResponse uses `identityPubkey`, not `receiverIdentityPubkey`.
// - GetTokensMetadataRequest uses `tokenIdentifiers`, not `identifiers`.
// - `ConnectRequest` has no `accountNumber` field — passing it on the
//   request is silently ignored. The supported path is
//   `SdkBuilder.new(config, seed).withKeySet({ keySetType, useAddressIndex,
//   accountNumber }).withDefaultStorage(dir).build()`. This script uses
//   that path so the account_number value is actually exercised.
import {
  connect,
  defaultConfig,
  SdkBuilder,
} from '@agicash/breez-sdk-spark';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const apiKey = process.env.VITE_BREEZ_API_KEY;
if (!apiKey) throw new Error('VITE_BREEZ_API_KEY required');

const USDB_MAINNET_ID =
  'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87';

type Sdk = Awaited<ReturnType<typeof connect>>;

async function openSdk(
  mnemonic: string,
  accountNumber: number | undefined,
  storageDir: string,
): Promise<Sdk> {
  const config = { ...defaultConfig('mainnet'), apiKey };
  const seed = { type: 'mnemonic' as const, mnemonic };

  if (accountNumber === undefined) {
    // The implicit-default path existing users are on.
    return await connect({ config, seed, storageDir });
  }

  // Explicit account_number path via SdkBuilder.
  let builder = SdkBuilder.new(config, seed).withKeySet({
    keySetType: 'default',
    useAddressIndex: false,
    accountNumber,
  });
  builder = await builder.withDefaultStorage(storageDir);
  return await builder.build();
}

async function main() {
  const mnemonic = generateMnemonic(wordlist);
  console.log(`Throwaway mnemonic: ${mnemonic}`);

  const candidates: (number | undefined)[] = [undefined, 0, 1, 2, 3];
  const pubkeys: Record<string, string> = {};

  for (const accountNumber of candidates) {
    const label = accountNumber === undefined ? 'undefined' : String(accountNumber);
    const dir = await mkdtemp(join(tmpdir(), 'spark-preflight-'));
    let sdk: Sdk | undefined;
    try {
      sdk = await openSdk(mnemonic, accountNumber, dir);
      const info = await sdk.getInfo({});
      pubkeys[label] = info.identityPubkey ?? '(no pubkey returned)';
      console.log(`account_number=${label} → ${pubkeys[label]}`);

      if (accountNumber === undefined) {
        // While we're here, sanity-check USDB metadata.
        try {
          const metadata = await sdk.getTokensMetadata({
            tokenIdentifiers: [USDB_MAINNET_ID],
          });
          console.log('USDB metadata:', JSON.stringify(metadata, null, 2));
        } catch (e) {
          console.error('USDB metadata fetch FAILED:', e);
        }
      }
    } catch (e) {
      pubkeys[label] = `(error: ${(e as Error)?.message ?? String(e)})`;
      console.error(`account_number=${label} FAILED:`, e);
    } finally {
      if (sdk) {
        try {
          await sdk.disconnect();
        } catch (e) {
          console.error('disconnect failed (continuing):', e);
        }
      }
      await rm(dir, { recursive: true, force: true });
    }
  }

  console.log('\nSummary:');
  const grouped = new Map<string, string[]>();
  for (const [label, pubkey] of Object.entries(pubkeys)) {
    const existing = grouped.get(pubkey) ?? [];
    existing.push(label);
    grouped.set(pubkey, existing);
  }
  for (const [pubkey, labels] of grouped) {
    console.log(`  ${labels.join(', ')} → ${pubkey}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
