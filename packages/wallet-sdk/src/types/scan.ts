/**
 * Scan / payment-intent types — §3 of the contract.
 *
 * `ParsedDestination` is the contract's reshape of master's
 * `app/features/scan/classify-input.ts#ClassifiedInput` into kinds
 * `bolt11` / `ln-address` / `cashu-token`. `PaymentIntent` is the input to
 * `accounts.suggestFor`.
 */
import type { Bolt11Invoice, ParsedToken } from './dependencies';
import type { Money } from './money';

/**
 * The classified result of {@link ScanDomain.parse} — what a scanned/pasted
 * string resolves to. `kind` discriminates the payload: a decoded BOLT11
 * invoice, a Lightning address (resolved to an invoice later, when the amount is
 * known), or a parsed cashu token.
 */
export type ParsedDestination =
  | { kind: 'bolt11'; invoice: Bolt11Invoice }
  | { kind: 'ln-address'; address: string }
  | { kind: 'cashu-token'; token: ParsedToken };

/**
 * What the user wants to do, fed into {@link AccountsDomain.suggestFor} to pick
 * an account. A `send` carries the parsed destination (and an optional amount
 * for amountless invoices / ln-addresses); a `receive` carries an optional
 * amount; a `token-receive` carries the raw token string.
 */
export type PaymentIntent =
  | { kind: 'send'; destination: ParsedDestination; amount?: Money }
  | { kind: 'receive'; amount?: Money }
  | { kind: 'token-receive'; token: string };
