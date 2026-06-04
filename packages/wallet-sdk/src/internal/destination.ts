/**
 * Internal send-`Destination` resolution — Slice 4 (contacts / send-to-contact).
 *
 * Pure helper backing the net-new typed {@link Destination} (decision 6). GENERALIZES master's
 * `send/resolve-destination.ts` `AGICASH_CONTACT` branch: given a `Destination`, produce the two
 * things the cashu/spark lightning-send path consumes —
 *  - the `paymentTarget` string the send's `createLightningQuote` resolves (a bolt11 invoice or a
 *    `user@domain` ln-address; for a contact it is the contact's `lud16`, resolved via LNURL-pay),
 *  - the optional {@link DestinationDetails} stamped on the send so the resulting transaction
 *    records `{ sendType: 'AGICASH_CONTACT', contactId }` (master's contact link) or
 *    `{ sendType: 'LN_ADDRESS', lnAddress }`, undefined when paying a bare bolt11.
 *
 * Pure (no DB, no network) — so it can be unit-tested directly and reused by both send domains.
 *
 * @module
 */
import type { DestinationDetails } from '../types/cashu';
import type { Destination } from '../types/destination';

/** The resolved send target derived from a {@link Destination}. */
export type ResolvedDestination = {
  /** The bolt11 invoice OR `user@domain` ln-address the send resolves (a contact's `lud16`). */
  paymentTarget: string;
  /**
   * The details stamped on the send for history. Present for a contact (`AGICASH_CONTACT`) or an
   * ln-address (`LN_ADDRESS`); `undefined` when the target is a bare bolt11 invoice.
   */
  destinationDetails?: DestinationDetails;
};

/**
 * Resolve a typed {@link Destination} into its `{ paymentTarget, destinationDetails }`.
 *
 * - `agicash-contact` → target = the contact's `lud16`; details = `{ sendType: 'AGICASH_CONTACT',
 *   contactId }` (preserves the contact link).
 * - `payment-request` → target = the raw string; details = `{ sendType: 'LN_ADDRESS', lnAddress }`
 *   when it is a `user@domain` ln-address (detected by an `@`), else `undefined` (a bare bolt11).
 *
 * @param destination - the typed destination.
 * @returns the resolved target + optional details.
 */
export function resolveDestination(
  destination: Destination,
): ResolvedDestination {
  if (destination.kind === 'agicash-contact') {
    return {
      paymentTarget: destination.contact.lud16,
      destinationDetails: {
        sendType: 'AGICASH_CONTACT',
        contactId: destination.contact.id,
      },
    };
  }

  const { paymentRequest } = destination;
  if (paymentRequest.includes('@')) {
    return {
      paymentTarget: paymentRequest,
      destinationDetails: { sendType: 'LN_ADDRESS', lnAddress: paymentRequest },
    };
  }
  return { paymentTarget: paymentRequest };
}
