// Scan / payment-intent types — §3 of the contract.
//
// `ParsedDestination` is the contract's reshape of master's
// `app/features/scan/classify-input.ts#ClassifiedInput` into kinds
// `bolt11` / `ln-address` / `cashu-token`. `PaymentIntent` is the input to
// `accounts.suggestFor`.
//
// RECONCILIATION (Slice 2 / PR4): the `Bolt11Invoice` + `ParsedToken` payload shapes are
// resolved to the REAL decode-lib outputs the `scan.parse` impl actually produces — the
// reactive base shipped placeholder shapes (`{ paymentRequest; paymentHash; ... }` /
// `{ token; amount?; mintUrl? }`) that no scan code consumed and that do NOT match the live
// libs. `parseBolt11Invoice` returns `lib/bolt11#DecodedBolt11` and `extractCashuToken`
// returns `{ encoded; metadata: TokenMetadata }`; the shapes below mirror those verbatim
// (matching the no-cache extraction's types). Nothing in the prior slices used the old
// shapes, so this is a non-breaking correction.

import type { Money } from './money';

/**
 * Decoded BOLT11 invoice carried by a `bolt11` `ParsedDestination`.
 * Shape = `lib/bolt11/index.ts#DecodedBolt11` (verbatim — what `parseBolt11Invoice`
 * returns).
 */
export type Bolt11Invoice = {
  /** Invoice amount in millisatoshis, or undefined for amountless invoices. */
  amountMsat: number | undefined;
  /** Invoice amount in satoshis, or undefined for amountless invoices. */
  amountSat: number | undefined;
  /** Invoice creation time, Unix epoch milliseconds. */
  createdAtUnixMs: number;
  /** Invoice expiry time, Unix epoch milliseconds. */
  expiryUnixMs: number;
  /** Network the invoice is for (e.g. "bitcoin"/"testnet"), or undefined. */
  network: string | undefined;
  /** Invoice description/memo, or undefined. */
  description: string | undefined;
  /** Public key of the payee node. */
  payeeNodeKey: string;
  /** Payment hash of the invoice. */
  paymentHash: string;
};

/**
 * Parsed cashu token metadata carried by a `cashu-token` `ParsedDestination`.
 * Master = `@cashu/cashu-ts`'s `TokenMetadata` (returned by `extractCashuToken`).
 * `extractCashuToken` returns `{ encoded; metadata: TokenMetadata }`.
 *
 * TODO(Slice-2/3): `import type { TokenMetadata } from '@cashu/cashu-ts'` and type
 * `metadata` as it (the package depends on `@cashu/cashu-ts` once cashu ops land).
 */
export type ParsedToken = {
  /** The re-encoded token string. */
  encoded: string;
  /** cashu-ts `TokenMetadata` (mint/unit/amount summary). */
  metadata: unknown;
};

/**
 * The classified result of {@link ScanDomain.parse} — what a scanned/pasted string resolves
 * to. `kind` discriminates the payload: a decoded BOLT11 invoice, a Lightning address
 * (resolved to an invoice later, when the amount is known), or a parsed cashu token.
 */
export type ParsedDestination =
  | { kind: 'bolt11'; invoice: Bolt11Invoice }
  | { kind: 'ln-address'; address: string }
  | { kind: 'cashu-token'; token: ParsedToken };

/**
 * What the user wants to do, fed into {@link AccountsDomain.suggestFor} to pick an account.
 * A `send` carries the parsed destination (and an optional amount for amountless invoices /
 * ln-addresses); a `receive` carries an optional amount; a `token-receive` carries the raw
 * token string.
 */
export type PaymentIntent =
  | { kind: 'send'; destination: ParsedDestination; amount?: Money }
  | { kind: 'receive'; amount?: Money }
  | { kind: 'token-receive'; token: string };
