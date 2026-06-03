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

export type ParsedDestination =
  | { kind: 'bolt11'; invoice: Bolt11Invoice }
  | { kind: 'ln-address'; address: string }
  | { kind: 'cashu-token'; token: ParsedToken };

export type PaymentIntent =
  | { kind: 'send'; destination: ParsedDestination; amount?: Money }
  | { kind: 'receive'; amount?: Money }
  | { kind: 'token-receive'; token: string };
