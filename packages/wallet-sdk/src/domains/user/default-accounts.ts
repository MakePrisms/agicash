import type { DefaultAccountConfig } from '../../config';
import { SdkError } from '../../errors';
import type { Database } from '../../internal/db/database';

type AccountInput = Database['wallet']['CompositeTypes']['account_input'];

/**
 * Normalize a mint URL: trim + strip trailing slashes; lowercase scheme + host
 * (path case preserved). Inlined from `app/lib/cashu/utils.ts`; the canonical
 * cashu utils land in S5.
 */
export function normalizeMintUrl(mintUrl: string): string {
  const trimmed = mintUrl.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

/** Map a {@link DefaultAccountConfig} to the DB `account_input` composite. */
export function toAccountInput(config: DefaultAccountConfig): AccountInput {
  if (config.type === 'cashu') {
    return {
      type: 'cashu',
      purpose: config.purpose,
      currency: config.currency,
      name: config.name,
      details: {
        mint_url: normalizeMintUrl(config.mintUrl),
        is_test_mint: config.isTestMint,
        keyset_counters: {},
      },
      is_default: config.isDefault,
    };
  }
  return {
    type: 'spark',
    purpose: config.purpose,
    currency: config.currency,
    name: config.name,
    details: { network: config.network },
    is_default: config.isDefault,
  };
}

/**
 * Build the `account_input[]` for the user-row bootstrap, validating that at
 * least one BTC Spark account is present (the RPC requires it).
 */
export function buildDefaultAccountInputs(
  defaults: DefaultAccountConfig[],
): AccountInput[] {
  const hasBtcSpark = defaults.some(
    (a) => a.type === 'spark' && a.currency === 'BTC',
  );
  if (!hasBtcSpark) {
    throw new SdkError(
      'defaultAccounts must include a BTC Spark account to bootstrap a user',
      'INVALID_DEFAULT_ACCOUNTS',
    );
  }
  return defaults.map(toAccountInput);
}

/** The Breez network for the spark identity pubkey, from the BTC Spark default. */
export function sparkNetworkForBootstrap(
  defaults: DefaultAccountConfig[],
): 'mainnet' | 'regtest' {
  const sparkBtc = defaults.find(
    (a) => a.type === 'spark' && a.currency === 'BTC',
  );
  const network =
    sparkBtc && sparkBtc.type === 'spark' ? sparkBtc.network : 'MAINNET';
  return network.toLowerCase() as 'mainnet' | 'regtest';
}
