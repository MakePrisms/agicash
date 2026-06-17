export type MintQuoteOutcome = 'paid' | 'issued' | 'expired';

/**
 * Pure port of the app's `processMintQuote` classification
 * (`cashu-receive-quote-hooks.ts:551-557`): an UNPAID mint quote past the receive
 * quote's expiry is expired (the socket emits no expiry event); PAID completes the
 * receive; ISSUED re-completes (recovery if the app died after minting but before
 * marking COMPLETED).
 * @param state - the mint quote's `state` (from `MintQuoteBolt11Response`).
 * @param receiveQuoteExpiresAt - the related receive quote's ISO `expiresAt`.
 */
export function classifyMintQuoteUpdate(
  state: string,
  receiveQuoteExpiresAt: string,
): MintQuoteOutcome | undefined {
  if (state === 'UNPAID') {
    return new Date(receiveQuoteExpiresAt) < new Date() ? 'expired' : undefined;
  }
  if (state === 'PAID') return 'paid';
  if (state === 'ISSUED') return 'issued';
  return undefined;
}
