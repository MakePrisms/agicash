/**
 * Send `Destination` — §8 of the contract, Slice 4. NET-NEW typed union (decision 6).
 *
 * The user-facing target of a send. A send to a saved {@link Contact} rides the typed
 * `agicash-contact` kind (which PRESERVES the contact context — the `contactId` so the SDK can
 * stamp the lightning send's `DestinationDetails` as `{ sendType: 'AGICASH_CONTACT', contactId }`,
 * §5 — and the `lud16` so it can resolve the invoice via LNURL-pay) rather than collapsing the
 * contact down to a bare `lud16` string (which would lose the contact link on the resulting
 * transaction). A raw bolt11 / ln-address rides the `payment-request` kind.
 *
 * This GENERALIZES master's `send/resolve-destination.ts#SendDestination` (whose `AGICASH_CONTACT`
 * branch carries the full `Contact`) into the SDK's framework-free surface: it is the input the
 * send domains can accept to know they are paying a contact. The pure
 * `internal/destination.ts#resolveContactDestination` derives the `{ lud16, destinationDetails }`
 * the cashu/spark lightning-send path needs.
 */
import type { Contact } from './contact';

/**
 * A send target.
 *
 * - `payment-request`: a raw bolt11 invoice or `user@domain` Lightning address string (the
 *   ln-address is resolved to an invoice inside `createLightningQuote`, §3).
 * - `agicash-contact`: a send to a saved {@link Contact} — preserves the contact link so the
 *   resulting transaction records `sendType: 'AGICASH_CONTACT'` with the `contactId`.
 */
export type Destination =
  | { kind: 'payment-request'; paymentRequest: string }
  | { kind: 'agicash-contact'; contact: Contact };
