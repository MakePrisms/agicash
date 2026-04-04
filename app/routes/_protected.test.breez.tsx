import { useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { sparkMnemonicQueryOptions } from '~/features/shared/spark';
import { connectBreezWallet } from '~/lib/breez-spark/init';
import { getSparkIdentityPublicKeyFromMnemonic } from '~/lib/spark';

type TestResult = {
  sparkKey: string;
  breezKey: string;
  match: boolean;
};

export default function TestBreezKeyDerivation() {
  const { data: mnemonic } = useSuspenseQuery(sparkMnemonicQueryOptions());
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runTest = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Derive identity public key using current Spark SDK
      const sparkKey = await getSparkIdentityPublicKeyFromMnemonic(
        mnemonic,
        'MAINNET',
      );

      // Initialize Breez wallet and get identity public key
      const breezSdk = await connectBreezWallet(mnemonic);
      try {
        const info = await breezSdk.getInfo({ ensureSynced: false });
        const breezKey = info.identityPubkey;

        setResult({
          sparkKey,
          breezKey,
          match: sparkKey === breezKey,
        });
      } finally {
        await breezSdk.disconnect();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mnemonic]);

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="font-bold text-2xl">C1: Key Derivation Compatibility</h1>
      <p className="text-muted-foreground text-sm">
        Derives the identity public key from the same mnemonic using both the
        current Spark SDK and the Breez SDK, then compares them. If they do not
        match, the migration is a dealbreaker.
      </p>

      <button
        type="button"
        onClick={runTest}
        disabled={loading}
        className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? 'Running...' : 'Run Key Derivation Test'}
      </button>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-red-800 text-sm dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">Error</p>
          <p className="mt-1 break-all font-mono text-xs">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div
            className={`rounded-md border p-4 text-center font-bold text-lg ${
              result.match
                ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
                : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
            }`}
          >
            {result.match ? 'MATCH' : 'MISMATCH'}
          </div>

          <div className="space-y-3">
            <div>
              <p className="font-medium text-muted-foreground text-xs uppercase">
                Spark SDK Identity Public Key
              </p>
              <p className="mt-1 break-all rounded bg-gray-100 p-2 font-mono text-xs dark:bg-gray-900">
                {result.sparkKey}
              </p>
            </div>
            <div>
              <p className="font-medium text-muted-foreground text-xs uppercase">
                Breez SDK Identity Public Key
              </p>
              <p className="mt-1 break-all rounded bg-gray-100 p-2 font-mono text-xs dark:bg-gray-900">
                {result.breezKey}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
