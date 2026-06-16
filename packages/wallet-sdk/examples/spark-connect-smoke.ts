import { KeyService } from '../src/internal/keys';
import type { OpenSecret } from '../src/internal/opensecret';
import { SparkWalletManager } from '../src/internal/spark/wallet-manager';

// Headless Breez connect() smoke. NOT part of the test gate — it needs a Breez
// API key and a reachable spark network. Run manually:
//
//   VITE_BREEZ_API_KEY=… bun packages/wallet-sdk/examples/spark-connect-smoke.ts
//
// It builds a KeyService over a fake Open Secret port that returns a fixed BIP39
// mnemonic, constructs a SparkWalletManager, connects on REGTEST, and logs the
// resulting { isOnline, balance }. This closes Plan 2's "full connect() validated
// in Plan 3" item.

const apiKey = process.env.VITE_BREEZ_API_KEY;
if (!apiKey) {
  throw new Error(
    'VITE_BREEZ_API_KEY is not set — needed to connect the Breez SDK.',
  );
}

// Standard BIP39 test-vector mnemonic. Any deterministic regtest wallet works.
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// KeyService only calls getPrivateKey({ seed_phrase_derivation_path }) to fetch
// the spark mnemonic; the rest of the OpenSecret surface is unused by getWallet.
const os = {
  getPrivateKey: async () => ({ mnemonic: MNEMONIC }),
} as unknown as OpenSecret;

const keys = new KeyService(os);
const sparkWallets = new SparkWalletManager(
  keys,
  apiKey,
  './.spark-data-smoke',
);

try {
  const { isOnline, balance } = await sparkWallets.getWallet('REGTEST');
  console.log('spark connect smoke:', {
    isOnline,
    balance: balance?.toString() ?? null,
  });
} finally {
  await sparkWallets.dispose();
}
