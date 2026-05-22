import type { Config } from '@agicash/breez-sdk-spark';
import { Money } from '~/lib/money';
import type { Currency } from '~/lib/money';
import type { SparkNetwork } from './network';

/**
 * Canonical mainnet token identifier for USDB.
 * https://sparkscan.io/token/3206c93b24a4d18ea19d0a9a213204af2c7e74a6d16c7535cc5d33eca4ad1eca?network=mainnet
 */
export const USDB_MAINNET_ID =
  'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87';

const USDB_DECIMALS = 6n;
const CENT_DECIMALS = 2n;
const SCALE_DOWN = 10n ** (USDB_DECIMALS - CENT_DECIMALS);

/**
 * Converts a raw USDB token balance (6-decimal `u128` base units) into a
 * `Money<'USD'>` denominated in cents. Half-away-from-zero rounding.
 *
 * Sub-cent precision is intentionally discarded — see
 * `docs/superpowers/specs/2026-05-21-spark-usdb-design.md` "Non-goals".
 */
export function convertUsdbToMoney(rawTokenBalance: bigint): Money<'USD'> {
  const half = SCALE_DOWN / 2n;
  const cents =
    rawTokenBalance >= 0n
      ? (rawTokenBalance + half) / SCALE_DOWN
      : -((-rawTokenBalance + half) / SCALE_DOWN);
  return new Money({ amount: cents.toString(), currency: 'USD', unit: 'cent' });
}

/**
 * Spark `KeySetConfig.accountNumber` per currency. Constants determined by
 * the Task 0 pre-flight; existing BTC users are on account_number 1 (the
 * SDK's implicit default in 0.13.5-1).
 */
export function getSparkAccountNumber(currency: Currency): number {
  switch (currency) {
    case 'BTC':
      return 1;
    case 'USD':
      return 2;
  }
}

/**
 * Returns the `stable_balance_config` for a Spark wallet of the given
 * `(currency, network)`. Returns `undefined` for any combination that should
 * not run the auto-conversion middleware (everything except USD on MAINNET).
 */
export function getSparkStableBalanceConfig(
  currency: Currency,
  network: SparkNetwork,
): Config['stableBalanceConfig'] {
  if (currency === 'USD' && network === 'MAINNET') {
    return {
      tokens: [{ label: 'USDB', tokenIdentifier: USDB_MAINNET_ID }],
      defaultActiveLabel: 'USDB',
      thresholdSats: 0,
    };
  }
  return undefined;
}
