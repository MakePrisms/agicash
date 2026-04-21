import {
  type Account,
  type CashuAccount,
  getAccountBalance,
} from '~/features/accounts/account';
import type { DecodedBolt11 } from '~/lib/bolt11';
import { Money } from '~/lib/money';
import {
  type MintDescriptionMap,
  MintDescriptionMapSchema,
} from './mint-description-config';

const parseMap = (): MintDescriptionMap => {
  const raw = import.meta.env.VITE_MINT_DESCRIPTION_MAP;
  if (!raw) return {};
  // Validated at build time by vite.config.ts — safe to throw here.
  return MintDescriptionMapSchema.parse(JSON.parse(raw));
};

export const MINT_DESCRIPTION_MAP: MintDescriptionMap = parseMap();

type SmartSelectionInput = {
  decoded: DecodedBolt11;
  accounts: CashuAccount[];
  defaultAccount: Account;
  /** BTC→USD rate. Required to evaluate USD account candidates. */
  btcToUsdRate?: string | number;
  mintDescriptionMap?: MintDescriptionMap;
};

/**
 * Picks the best source account to pay a BOLT11 invoice.
 *
 * If the invoice's description matches a configured mint, returns the first
 * cashu account at that mint whose balance covers the invoice amount (across
 * any currency the user holds at that mint). Falls back to the supplied
 * default account otherwise.
 *
 * USD candidates require `btcToUsdRate` to convert the invoice amount; if not
 * provided they are skipped.
 */
export const selectSourceAccountForBolt11 = ({
  decoded,
  accounts,
  defaultAccount,
  btcToUsdRate,
  mintDescriptionMap = MINT_DESCRIPTION_MAP,
}: SmartSelectionInput): Account => {
  if (!decoded.description) return defaultAccount;

  const mintUrl = mintDescriptionMap[decoded.description];
  if (!mintUrl) return defaultAccount;

  const candidates = accounts.filter((a) => a.mintUrl === mintUrl);
  if (candidates.length === 0) return defaultAccount;

  if (decoded.amountSat === undefined) return defaultAccount;

  const invoiceBtc = new Money({
    amount: decoded.amountSat,
    currency: 'BTC',
    unit: 'sat',
  });

  for (const candidate of candidates) {
    const balance = getAccountBalance(candidate);
    if (!balance) continue;

    if (candidate.currency === 'BTC') {
      if ((balance as Money<'BTC'>).greaterThanOrEqual(invoiceBtc)) {
        return candidate;
      }
    } else {
      if (btcToUsdRate === undefined) continue;
      const invoiceUsd = invoiceBtc.convert('USD', btcToUsdRate);
      if ((balance as Money<'USD'>).greaterThanOrEqual(invoiceUsd)) {
        return candidate;
      }
    }
  }

  return defaultAccount;
};
