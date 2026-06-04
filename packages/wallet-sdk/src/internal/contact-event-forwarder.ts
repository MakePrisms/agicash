/**
 * Internal contact realtime → SDK-event forwarder — Slice 4 (contacts).
 *
 * NET-NEW (the event-SHAPE contract for `contact:created` / `contact:deleted`, §11). GENERALIZES
 * master's `contact-hooks.ts#useContactChangeHandlers` (which maps the `CONTACT_CREATED` /
 * `CONTACT_DELETED` broadcast events into TanStack-cache add/remove): here it translates them into
 * the SDK's typed events.
 *
 * The op is encoded in the event NAME → distinct typed events: `CONTACT_CREATED` →
 * `contact:created` (carrying the full {@link Contact}, with its `lud16` computed from the
 * configured `domain`); `CONTACT_DELETED` → `contact:deleted` (carrying only the `contactId` —
 * contacts have no `version`, so dedupe/order is op-type + refetch, §8).
 *
 * The REALTIME SUBSCRIPTION that delivers these payloads is Slice 5/PR7 — THIS slice DEFINES +
 * tests the shape + the emit path. Slice 5 wires the channel to call {@link handleChange}.
 *
 * @module
 */
import { ContactRepository } from './contact-repository';
import type { TypedEventEmitter } from './event-emitter';
import type { AgicashDbContact } from './db-contact';
import type { SdkEventMap } from '../types/events';

/** The two contact realtime event names master broadcasts. */
export type ContactChangeEvent = 'CONTACT_CREATED' | 'CONTACT_DELETED';

/**
 * Translates `wallet.contacts` realtime DB-change payloads into the SDK's typed `contact:*`
 * events. Holds the Agicash `domain` (to compute a created contact's `lud16`) + the event
 * emitter; constructed by the SDK and driven by the Slice-5 realtime channel.
 */
export class ContactEventForwarder {
  /**
   * @param domain - the Agicash Lightning-address domain (for a created contact's `lud16`).
   * @param events - the SDK event emitter.
   */
  constructor(
    private readonly domain: string,
    private readonly events: TypedEventEmitter<SdkEventMap>,
  ) {}

  /**
   * Translate one contact DB-change into the matching typed SDK event.
   *
   * - `CONTACT_CREATED` → `contact:created` (the row mapped to a domain {@link Contact}).
   * - `CONTACT_DELETED` → `contact:deleted` (only the id is carried).
   *
   * @param event - the broadcast event name (encodes the op).
   * @param payload - the changed contact row.
   */
  handleChange(event: ContactChangeEvent, payload: AgicashDbContact): void {
    if (event === 'CONTACT_CREATED') {
      const contact = ContactRepository.toContact(payload, this.domain);
      this.events.emit('contact:created', { contact });
      return;
    }

    this.events.emit('contact:deleted', { contactId: payload.id });
  }
}
