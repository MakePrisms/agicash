import { z } from 'zod';
import { type CurrencyUnit, Money } from '~/lib/money';

const COOKIE_NAME = 'cashapp_pending_buy';

const MoneySchema = z.object({
  amount: z.string(),
  currency: z.enum(['BTC', 'USD']),
  unit: z.enum(['sat', 'msat', 'btc', 'cent', 'usd']),
});

const PendingCashAppBuySchema = z.object({
  quoteId: z.string(),
  transactionId: z.string(),
  accountId: z.string(),
  accountType: z.enum(['cashu', 'spark']),
  paymentRequest: z.string(),
  amount: MoneySchema,
  mintingFee: MoneySchema.optional(),
});

export type PendingCashAppBuy = {
  quoteId: string;
  transactionId: string;
  accountId: string;
  accountType: 'cashu' | 'spark';
  paymentRequest: string;
  amount: Money;
  mintingFee?: Money;
};

function parseMoney(data: z.infer<typeof MoneySchema>): Money {
  return new Money({
    amount: data.amount,
    currency: data.currency,
    unit: data.unit as CurrencyUnit,
  });
}

export function getPendingCashAppBuy(): PendingCashAppBuy | null {
  if (typeof document === 'undefined') return null;

  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${COOKIE_NAME}=`));

  if (!match) return null;

  try {
    const raw = JSON.parse(decodeURIComponent(match.split('=')[1]));
    const parsed = PendingCashAppBuySchema.parse(raw);

    return {
      quoteId: parsed.quoteId,
      transactionId: parsed.transactionId,
      accountId: parsed.accountId,
      accountType: parsed.accountType,
      paymentRequest: parsed.paymentRequest,
      amount: parseMoney(parsed.amount),
      mintingFee: parsed.mintingFee ? parseMoney(parsed.mintingFee) : undefined,
    };
  } catch {
    clearPendingCashAppBuy();
    return null;
  }
}

export function clearPendingCashAppBuy() {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export { COOKIE_NAME as PENDING_CASHAPP_BUY_COOKIE_NAME };
