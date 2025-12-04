import { DefaultSparkSigner, type NetworkType } from '@buildonspark/spark-sdk';
import {
  type CurrencyAmount as SparkCurrencyAmount,
  CurrencyUnit as SparkCurrencyUnit,
} from '@buildonspark/spark-sdk/types';
import { bytesToHex } from '@noble/hashes/utils';
import { type Currency, type CurrencyUnit, Money } from './money';

const sparkUnitToCurrencyUnit: {
  [K in SparkCurrencyUnit]: CurrencyUnit | null;
} = {
  [SparkCurrencyUnit.SATOSHI]: 'sat',
  [SparkCurrencyUnit.BITCOIN]: 'btc',
  [SparkCurrencyUnit.MILLISATOSHI]: 'msat',
  [SparkCurrencyUnit.NANOBITCOIN]: null,
  [SparkCurrencyUnit.MICROBITCOIN]: null,
  [SparkCurrencyUnit.MILLIBITCOIN]: null,
  [SparkCurrencyUnit.USD]: 'usd',
  [SparkCurrencyUnit.MXN]: null,
  [SparkCurrencyUnit.PHP]: null,
  [SparkCurrencyUnit.EUR]: null,
  [SparkCurrencyUnit.FUTURE_VALUE]: null,
};

const sparkUnitToCurrency: {
  [K in SparkCurrencyUnit]: Currency | null;
} = {
  [SparkCurrencyUnit.SATOSHI]: 'BTC',
  [SparkCurrencyUnit.BITCOIN]: 'BTC',
  [SparkCurrencyUnit.MILLISATOSHI]: 'BTC',
  [SparkCurrencyUnit.NANOBITCOIN]: null,
  [SparkCurrencyUnit.MICROBITCOIN]: null,
  [SparkCurrencyUnit.MILLIBITCOIN]: null,
  [SparkCurrencyUnit.USD]: 'USD',
  [SparkCurrencyUnit.MXN]: null,
  [SparkCurrencyUnit.PHP]: null,
  [SparkCurrencyUnit.EUR]: null,
  [SparkCurrencyUnit.FUTURE_VALUE]: null,
};

/**
 * Converts a Spark currency amount to a Money object
 * @param amount - Spark amount
 * @throws Error if the Spark currency is not supported by the Money object
 */
export const moneyFromSparkAmount = (amount: SparkCurrencyAmount): Money => {
  const currency = sparkUnitToCurrency[amount.originalUnit];
  const unit = sparkUnitToCurrencyUnit[amount.originalUnit];

  if (!currency || !unit) {
    throw new Error(`Unsupported Spark currency: ${amount.originalUnit}`);
  }

  return new Money({
    currency,
    amount: amount.originalValue,
    unit,
  });
};

/**
 * Uses the spark-sdk's `DefaultSparkSigner` to get the Spark identity public key from a mnemonic.
 * This method will return the same public key as the `SparkWallet.getIdentityPublicKey` method when the same mnemonic and account number are used.
 * @param mnemonic - The mnemonic to get the identity public key from.
 * @param network - The network to get the identity public key from.
 * @param accountNumber - The account number to get the identity public key from. Defaults to 1 for all networks except REGTEST.
 * @returns The Spark identity public key as a hex string.
 */
export async function getSparkIdentityPublicKeyFromMnemonic(
  mnemonic: string,
  network: NetworkType,
  accountNumber?: number,
): Promise<string> {
  const signer = new DefaultSparkSigner();
  const seed = await signer.mnemonicToSeed(mnemonic);

  // The spark sdk uses 0 for regtest and 1 for all other networks
  // See https://github.com/buildonspark/spark/blob/c40a1b081b7d6fdef34de544ae8768b4f6e1c1f4/sdks/js/packages/spark-sdk/src/spark-wallet/spark-wallet.ts#L1135-L1141
  const accountNumberToUse = accountNumber ?? (network === 'REGTEST' ? 0 : 1);

  // NOTE that this method defaults to 0 for the account number
  // See https://github.com/buildonspark/spark/blob/4265914443e254e4e8cd1ff7cdfca6a922b336d9/sdks/js/packages/spark-sdk/src/signer/signer.ts#L653
  await signer.createSparkWalletFromSeed(seed, accountNumberToUse);

  const publicKey = await signer.getIdentityPublicKey();
  return bytesToHex(publicKey);
}
