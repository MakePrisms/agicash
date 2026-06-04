// Scan + PaymentIntent + ParsedDestination types

import type { Money } from './money';

export type Bolt11Invoice = {
  paymentRequest: string;
  paymentHash: string;
  amountMsat?: number;
  description?: string;
  expiryTimestamp?: number;
};

export type ParsedToken = {
  token: string;
  amount?: number;
  mintUrl?: string;
};

export type ParsedDestination =
  | { kind: 'bolt11'; invoice: Bolt11Invoice }
  | { kind: 'ln-address'; address: string }
  | { kind: 'cashu-token'; token: ParsedToken }
  | { kind: 'agicash-contact'; contactId: string; username: string };

export type PaymentIntent =
  | { kind: 'send'; destination: ParsedDestination; amount?: Money }
  | { kind: 'receive'; amount?: Money }
  | { kind: 'token-receive'; token: string };
