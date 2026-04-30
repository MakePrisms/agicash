import type { DecodedBolt11 } from '~/lib/bolt11';
import { buildLightningAddressFormatValidator } from '~/lib/lnurl';
import { type Currency, Money } from '~/lib/money';

export type ValidateResult =
  | {
      valid: false;
      error: string;
    }
  | {
      valid: true;
      amount: Money<Currency> | null;
      currency: Currency;
      unit: 'sat' | 'cent';
    };

/**
 * Deep validation for a decoded BOLT11 invoice: checks network, expiry, and
 * (optionally) amount. Returns a typed success/failure result.
 */
export const validateBolt11 = (
  { network, amountSat, expiryUnixMs }: DecodedBolt11,
  { allowZeroAmount = false } = {},
): ValidateResult => {
  if (network !== 'bitcoin') {
    return {
      valid: false,
      error: `Unsupported network: ${network}. Only Bitcoin mainnet is supported`,
    };
  }

  if (expiryUnixMs) {
    const expiresAt = new Date(expiryUnixMs);
    const now = new Date();
    if (expiresAt < now) {
      return {
        valid: false,
        error: 'Invoice expired',
      };
    }
  }

  if (!amountSat && !allowZeroAmount) {
    return {
      valid: false,
      error: 'Amount is required for Lightning invoices',
    };
  }

  return {
    valid: true,
    amount: amountSat
      ? new Money({
          amount: amountSat,
          currency: 'BTC' as Currency,
          unit: 'sat',
        })
      : null,
    unit: 'sat',
    currency: 'BTC',
  };
};

/**
 * Format-level validator for Lightning addresses. Returns `true` if the input
 * parses as a well-formed address, or an error message string otherwise.
 */
export const validateLightningAddressFormat =
  buildLightningAddressFormatValidator({
    message: 'Invalid lightning address',
    allowLocalhost: import.meta.env.MODE === 'development',
  });
