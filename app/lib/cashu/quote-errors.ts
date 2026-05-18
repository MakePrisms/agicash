import { MintOperationError } from '@cashu/cashu-ts';
import { Money } from '~/lib/money';
import { CashuErrorCodes } from './error-codes';

type MintQuotaExceededData = {
  limit: number;
  used: number;
  unit: string;
  window_secs?: number;
  retry_after?: number;
};

const cashuProtocolUnitToMoneyInput: Record<
  string,
  { currency: 'BTC'; unit: 'sat' } | { currency: 'USD'; unit: 'cent' }
> = {
  sat: { currency: 'BTC', unit: 'sat' },
  usd: { currency: 'USD', unit: 'cent' },
};

const isMintQuotaExceededData = (
  value: unknown,
): value is MintQuotaExceededData => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const data = value as Record<string, unknown>;
  return (
    typeof data.limit === 'number' &&
    typeof data.used === 'number' &&
    typeof data.unit === 'string'
  );
};

const humanizeRetryAfter = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (safeSeconds < 60) {
    return `${safeSeconds}s`;
  }
  const minutes = Math.floor(safeSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 24) {
    return remainderMinutes === 0
      ? `${hours}h`
      : `${hours}h ${remainderMinutes}m`;
  }
  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return remainderHours === 0 ? `${days}d` : `${days}d ${remainderHours}h`;
};

const formatRemaining = (data: MintQuotaExceededData): string | null => {
  const moneyInput = cashuProtocolUnitToMoneyInput[data.unit];
  if (!moneyInput) {
    return null;
  }
  const remaining = Math.max(0, data.limit - data.used);
  const money = new Money({
    amount: remaining,
    currency: moneyInput.currency,
    unit: moneyInput.unit,
  });
  return money.toLocaleString({ unit: moneyInput.unit });
};

/**
 * Converts an error thrown by a Cashu mint quote request into a message
 * suitable for display to the user.
 *
 * When the mint returns a quota-exceeded error (NUT error code 33001) with
 * structured `data`, returns a friendly message including the remaining limit
 * and an optional retry-after hint. Falls back to the raw `detail` when the
 * structured data is unavailable. For non-quota errors, returns the underlying
 * error message.
 */
export const formatCashuQuoteError = (error: unknown): string => {
  if (!(error instanceof MintOperationError)) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  if (error.code !== CashuErrorCodes.MINT_QUOTA_EXCEEDED) {
    return error.message;
  }

  const data = (error as MintOperationError & { data?: unknown }).data;
  if (!isMintQuotaExceededData(data)) {
    return getMintOperationErrorDetail(error);
  }

  const formattedRemaining = formatRemaining(data);
  if (!formattedRemaining) {
    return getMintOperationErrorDetail(error);
  }

  const baseMessage = `Amount exceeds remaining daily limit of ${formattedRemaining}`;
  if (typeof data.retry_after === 'number') {
    return `${baseMessage}. Try again in ${humanizeRetryAfter(data.retry_after)}`;
  }
  return baseMessage;
};

const getMintOperationErrorDetail = (error: MintOperationError): string => {
  const detail = (error as MintOperationError & { detail?: unknown }).detail;
  if (typeof detail === 'string' && detail.length > 0) {
    return detail;
  }
  return error.message;
};
