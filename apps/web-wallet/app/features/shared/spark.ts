// React binding for the SDK spark-balance tracking. The spark connection layer
// lives in @agicash/wallet-sdk/spark; the DEBUG_LOGGING_SPARK wiring now lives
// in the SDK root alongside the feature-flags domain.
import { useEffect } from 'react';
// Configures the SDK (incl. the spark/Breez API key) for every import path
// that reaches spark — including the server-side lightning-address flow.
import { useSdk } from './sdk';

export function useTrackAndUpdateSparkAccountBalances() {
  const sdk = useSdk();
  // The SDK observes the current user's online spark accounts internally and
  // tracks their balances; this binds that to the component lifecycle.
  useEffect(() => sdk.accounts.startSparkBalanceTracking(), [sdk]);
}
