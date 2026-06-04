import { describe, expect, test } from 'bun:test';
import { ContactEventForwarder } from './contact-event-forwarder';
import { TypedEventEmitter } from './event-emitter';
import type { AgicashDbContact } from './db-contact';
import type { SdkEventMap } from '../events';

const row: AgicashDbContact = {
  id: 'c1',
  created_at: '2026-02-02T00:00:00.000Z',
  owner_id: 'u1',
  username: 'alice',
};

describe('ContactEventForwarder (net-new contact:* events, §11)', () => {
  test('CONTACT_CREATED → contact:created carrying the domain Contact (lud16 computed)', () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    const seen: SdkEventMap['contact:created'][] = [];
    events.on('contact:created', (e) => seen.push(e));

    new ContactEventForwarder('agicash.me', events).handleChange(
      'CONTACT_CREATED',
      row,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.contact).toEqual({
      id: 'c1',
      createdAt: '2026-02-02T00:00:00.000Z',
      ownerId: 'u1',
      username: 'alice',
      lud16: 'alice@agicash.me',
    });
  });

  test('CONTACT_DELETED → contact:deleted carrying ONLY the contactId', () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    const seen: SdkEventMap['contact:deleted'][] = [];
    events.on('contact:deleted', (e) => seen.push(e));

    new ContactEventForwarder('agicash.me', events).handleChange(
      'CONTACT_DELETED',
      row,
    );

    expect(seen).toEqual([{ contactId: 'c1' }]);
  });

  test('the op is read from the event NAME (a CREATE does not emit contact:deleted)', () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    let deleted = 0;
    events.on('contact:deleted', () => deleted++);

    new ContactEventForwarder('agicash.me', events).handleChange(
      'CONTACT_CREATED',
      row,
    );

    expect(deleted).toBe(0);
  });
});
