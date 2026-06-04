import { describe, expect, test } from 'bun:test';
import { resolveDestination } from './destination';
import type { Contact } from '../types/contact';
import type { Destination } from '../types/destination';

const contact: Contact = {
  id: 'c1',
  createdAt: '2026-01-01T00:00:00.000Z',
  ownerId: 'u1',
  username: 'alice',
  lud16: 'alice@agicash.me',
};

describe('resolveDestination (typed Destination, decision 6)', () => {
  test('agicash-contact resolves to the contact lud16 + preserves the contact link', () => {
    const dest: Destination = { kind: 'agicash-contact', contact };

    const resolved = resolveDestination(dest);

    // Resolves to the contact's lud16 (so createLightningQuote can LNURL-resolve it)...
    expect(resolved.paymentTarget).toBe('alice@agicash.me');
    // ...and stamps the AGICASH_CONTACT details with the contactId (the preserved link).
    expect(resolved.destinationDetails).toEqual({
      sendType: 'AGICASH_CONTACT',
      contactId: 'c1',
    });
  });

  test('payment-request that is an ln-address stamps LN_ADDRESS details', () => {
    const dest: Destination = {
      kind: 'payment-request',
      paymentRequest: 'bob@example.com',
    };

    const resolved = resolveDestination(dest);

    expect(resolved.paymentTarget).toBe('bob@example.com');
    expect(resolved.destinationDetails).toEqual({
      sendType: 'LN_ADDRESS',
      lnAddress: 'bob@example.com',
    });
  });

  test('payment-request that is a bare bolt11 carries NO destinationDetails', () => {
    const dest: Destination = {
      kind: 'payment-request',
      paymentRequest: 'lnbc1pabc...',
    };

    const resolved = resolveDestination(dest);

    expect(resolved.paymentTarget).toBe('lnbc1pabc...');
    expect(resolved.destinationDetails).toBeUndefined();
  });
});
