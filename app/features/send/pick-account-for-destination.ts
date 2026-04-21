import { type Account, getAccountBalance } from '~/features/accounts/account';
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

type PickAccountForDestinationInput = {
  decodedDestination: DecodedBolt11;
  accounts: Account[];
  defaultAccount: Account;
  mintDescriptionMap?: MintDescriptionMap;
};

/**
 * Picks the best account to pay a BOLT11 invoice.
 *
 * If the invoice's description matches a configured mint, returns the first
 * BTC cashu account at that mint whose balance covers the invoice amount.
 * Falls back to the supplied default account otherwise.
 *
 * USD candidates are not evaluated yet — to be revisited.
 */
export const pickAccountForDestination = ({
  decodedDestination,
  accounts,
  defaultAccount,
  mintDescriptionMap = MINT_DESCRIPTION_MAP,
}: PickAccountForDestinationInput): Account => {
  if (!decodedDestination.description) return defaultAccount;

  const mintUrl = mintDescriptionMap[decodedDestination.description];
  if (!mintUrl) return defaultAccount;

  const candidates = accounts.filter(
    (a) => a.type === 'cashu' && a.mintUrl === mintUrl && a.currency === 'BTC',
  );
  if (candidates.length === 0) return defaultAccount;

  if (decodedDestination.amountSat === undefined) return defaultAccount;

  const invoiceBtc = new Money({
    amount: decodedDestination.amountSat,
    currency: 'BTC',
    unit: 'sat',
  });

  for (const candidate of candidates) {
    const balance = getAccountBalance(candidate) as Money<'BTC'> | undefined;
    if (balance?.greaterThanOrEqual(invoiceBtc)) {
      return candidate;
    }
  }

  return defaultAccount;
};
