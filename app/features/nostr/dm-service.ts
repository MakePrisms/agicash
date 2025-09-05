import { hexToBytes } from '@noble/hashes/utils';
import type { PrivateKeyBytesResponse } from '@opensecret/react';
import { RelayPool } from 'applesauce-relay';
import { getPublicKey, nip17 } from 'nostr-tools';
import {
  createBitchatBinaryPacket,
  generateMessageId,
} from './bitchat-protocol';

/**
 * Service for sending NIP-17 encrypted direct messages with BitChat protocol integration
 *
 * Message flow (corrected for BitChat compatibility):
 * 1. Plain text message -> BitChat protocol formatting ([BITCHAT:PM]:messageID:recipient_peer_id:sender_peer_id:message)
 * 2. BitChat formatted message -> Binary packet encoding with TLV structure
 * 3. Binary packet -> Base64url encoding with 'bitchat1:' prefix (BitChat's expected format)
 * 4. BitChat binary content -> NIP-17 gift wrapping (kind 1059 -> kind 13 -> kind 14)
 * 5. Gift wrapped event -> Published to Nostr relays
 *
 * Uses nostr-tools for gift wrapping and RelayPool for publishing (following demo pattern)
 */
export class DirectMessageService {
  private readonly pool: RelayPool;

  constructor(
    private readonly getPrivateKeyBytes: () => Promise<PrivateKeyBytesResponse>,
    private readonly defaultRelays: string[] = [
      // BitChat's default relays (from NostrRelayManager.swift)
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.primal.net',
      'wss://offchain.pub',
      'wss://nostr21.com',
      // Additional relays for better coverage
      'wss://relay.snort.social',
      'wss://nostr.oxtr.dev',
      'wss://relay.nostr.band',
      'wss://nostr-pub.wellorder.net',
    ],
  ) {
    this.pool = new RelayPool();
  }

  /**
   * Send an encrypted direct message following NIP-17 specification
   * @param recipientPubkey - Recipient's public key (hex string)
   * @param message - The message content
   * @param options - Optional parameters including relay URLs to use
   */
  async sendDirectMessage(
    recipientPubkey: string,
    message: string,
    options: {
      /** Event ID being replied to */
      replyToEventId?: string;
      /** Relay URL for the reply-to event */
      replyRelayUrl?: string;
      /** Conversation title for group chats */
      conversationTitle?: string;
      /** Relay URLs to publish to (uses default if not provided) */
      relayUrls?: string[];
    } = {},
  ): Promise<{ success: boolean; eventId?: string; error?: string }> {
    try {
      const relaysToUse = [...this.defaultRelays, ...(options.relayUrls || [])];

      console.debug('🔐 Starting NIP-17 DM send process:', {
        recipientPubkey: `${recipientPubkey.substring(0, 16)}...`,
        usingCustomRelays: !!options.relayUrls,
        bitchatCompatibilityMode: 'enabled - using bitchat1: binary format',
      });

      // Get sender's private key and derive public key
      const senderPrivateKey = await this.getPrivateKeyBytes().then(
        (response) => response.private_key,
      );
      const senderPubkey = getPublicKey(hexToBytes(senderPrivateKey));

      console.debug('🔑 Retrieved sender key info:', {
        privateKeyLength: senderPrivateKey.length,
        publicKey: `${senderPubkey.slice(0, 8)}...${senderPubkey.slice(-8)}`,
      });

      // Prepare recipient and reply-to data
      const recipient = {
        publicKey: recipientPubkey,
        // TODO: Could fetch recipient's preferred relays from their profile
      };

      const replyTo = options.replyToEventId
        ? {
            eventId: options.replyToEventId,
            relayUrl: options.replyRelayUrl,
          }
        : undefined;

      // Generate BitChat protocol identifiers
      const messageId = generateMessageId();

      // Pass full pubkeys - let BitChat's normalizeRecipientPeerID handle derivation for better compatibility
      const bitchatBinaryContent = createBitchatBinaryPacket(
        messageId,
        recipientPubkey, // Pass full 64-char pubkey
        senderPubkey, // Pass full 64-char pubkey
        message,
      );

      console.debug('📝 Prepared BitChat message data:', {
        messageId,
        senderPubkey: `${senderPubkey.substring(0, 16)}...`,
        recipientPubkey: `${recipientPubkey.substring(0, 16)}...`,
        originalMessage: message,
        bitchatBinaryContent,
        recipient,
        replyTo,
        conversationTitle: options.conversationTitle,
      });

      // Create gift-wrapped event using nostr-tools with BitChat binary content
      // CRITICAL: Use recent timestamp to avoid BitChat's 24-hour age filter
      const giftWrappedEvent = nip17.wrapEvent(
        hexToBytes(senderPrivateKey),
        recipient,
        bitchatBinaryContent, // Use BitChat binary format that BitChat expects
        options.conversationTitle,
        replyTo,
      );

      // TEMPORARILY DISABLED: Test without timestamp adjustment
      // TODO: Re-enable timestamp adjustment logic if needed after testing
      // BitChat filters messages older than 24 hours (86400 seconds)

      /*
      if (giftWrappedEvent.created_at < now - maxAge + 900) {
        // Add 15 min buffer
        // Force a recent timestamp to ensure BitChat doesn't filter it out
        giftWrappedEvent.created_at = now - Math.floor(Math.random() * 300); // 0-5 minutes ago

        // Re-sign the event with the new timestamp using nostr-tools
        const eventTemplate = {
          pubkey: giftWrappedEvent.pubkey,
          created_at: giftWrappedEvent.created_at,
          kind: giftWrappedEvent.kind,
          tags: giftWrappedEvent.tags,
          content: giftWrappedEvent.content,
        };

        // Use finalizeEvent to properly calculate ID and signature
        const finalizedEvent = finalizeEvent(
          eventTemplate,
          hexToBytes(senderPrivateKey),
        );

        // Update the gift-wrapped event with correct ID and signature
        giftWrappedEvent.id = finalizedEvent.id;
        giftWrappedEvent.sig = finalizedEvent.sig;

        console.debug(
          '🕐 Adjusted gift wrap timestamp for BitChat compatibility:',
          {
            originalTime: new Date((now - maxAge + 900) * 1000).toISOString(),
            adjustedTime: new Date(
              giftWrappedEvent.created_at * 1000,
            ).toISOString(),
            ageMinutes: Math.floor((now - giftWrappedEvent.created_at) / 60),
          },
        );
      }
      */

      console.debug('🎁 Created gift-wrapped DM event (BitChat compatible):', {
        eventId: giftWrappedEvent.id,
        kind: giftWrappedEvent.kind,
        pubkey: `${giftWrappedEvent.pubkey.substring(0, 16)}...`,
        created_at: giftWrappedEvent.created_at,
        timestamp: new Date(giftWrappedEvent.created_at * 1000).toISOString(),
        ageMinutes: Math.floor(
          (Date.now() / 1000 - giftWrappedEvent.created_at) / 60,
        ),
        tags: giftWrappedEvent.tags,
        contentLength: giftWrappedEvent.content.length,
        contentPreview: `${giftWrappedEvent.content.substring(0, 100)}...`,
        recipientPubkey: `${recipientPubkey.substring(0, 16)}...`,
        bitchatAgeFilterStatus:
          giftWrappedEvent.created_at > Date.now() / 1000 - 87300
            ? '✅ PASS'
            : '❌ FAIL',
      });

      // Publish the event using RelayPool (following demo pattern)
      console.debug('📡 Publishing to relays:', {
        relays: relaysToUse,
        eventToPublish: {
          id: giftWrappedEvent.id,
          kind: giftWrappedEvent.kind,
          created_at: giftWrappedEvent.created_at,
        },
      });

      const publishResults = await this.pool.publish(
        relaysToUse,
        giftWrappedEvent,
      );

      console.debug(
        `✅ Published DM to ${publishResults.length} relays:`,
        publishResults.map((result) => ({
          success: result.ok,
          message: result.message,
          relay: result.from || 'unknown',
        })),
      );

      console.debug('🎉 Single recipient DM send completed successfully:', {
        eventId: giftWrappedEvent.id,
        recipientPubkey,
        relaysPublishedTo: publishResults.length,
      });

      return {
        success: true,
        eventId: giftWrappedEvent.id,
      };
    } catch (error) {
      console.error('❌ Failed to send direct message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send a direct message to multiple recipients
   * @param recipients - Array of recipient public keys
   * @param message - The message content
   * @param options - Optional parameters including relay URLs to use
   */
  async sendDirectMessageToMany(
    recipients: string[],
    message: string,
    options: {
      replyToEventId?: string;
      replyRelayUrl?: string;
      conversationTitle?: string;
      /** Relay URLs to publish to (uses default if not provided) */
      relayUrls?: string[];
    } = {},
  ): Promise<{
    success: boolean;
    results: Array<{
      recipientPubkey: string;
      eventId?: string;
      error?: string;
    }>;
  }> {
    try {
      // For BitChat compatibility, prioritize BitChat's trusted relays
      // Only use passed relays if they're explicitly provided and BitChat-compatible
      const relaysToUse = options.relayUrls?.length
        ? options.relayUrls
        : this.defaultRelays;

      console.debug(
        '🔐 Starting NIP-17 multi-recipient DM send (BitChat compatible):',
        {
          recipientCount: recipients.length,
          recipients,
          messageLength: message.length,
          messagePreview: `${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
          options,
          relaysToUse,
          usingCustomRelays: !!options.relayUrls,
        },
      );

      const senderPrivateKey = await this.getPrivateKeyBytes().then(
        (response) => response.private_key,
      );
      const senderPubkey = getPublicKey(hexToBytes(senderPrivateKey));

      console.debug('🔑 Retrieved sender key info:', {
        privateKeyLength: senderPrivateKey.length,
        publicKey: `${senderPubkey.slice(0, 8)}...${senderPubkey.slice(-8)}`,
      });

      // Prepare recipients data
      const recipientsData = recipients.map((pubkey) => ({
        publicKey: pubkey,
      }));

      const replyTo = options.replyToEventId
        ? {
            eventId: options.replyToEventId,
            relayUrl: options.replyRelayUrl,
          }
        : undefined;

      // Generate BitChat protocol identifiers and create binary packets for each recipient
      const messageId = generateMessageId();

      // Create BitChat binary packets for each recipient
      // Pass full pubkeys - let BitChat's normalizeRecipientPeerID handle derivation for better compatibility
      const bitchatBinaryContents = recipients.map((recipientPubkey) => {
        return createBitchatBinaryPacket(
          messageId,
          recipientPubkey, // Pass full 64-char pubkey
          senderPubkey, // Pass full 64-char pubkey
          message,
        );
      });

      console.debug('📝 Prepared multi-recipient BitChat data:', {
        messageId,
        senderPubkey: `${senderPubkey.substring(0, 16)}...`,
        recipients: recipients.map((pubkey, index) => ({
          pubkey: `${pubkey.substring(0, 16)}...`,
          binaryContent: bitchatBinaryContents[index],
        })),
        recipientsData,
        replyTo,
        conversationTitle: options.conversationTitle,
        originalMessage: message,
      });

      // Create gift-wrapped events for all recipients using BitChat binary content
      // Note: wrapManyEvents expects a single message, so we need to create individual events
      const giftWrappedEvents = recipients.map((recipientPubkey, index) => {
        const giftWrappedEvent = nip17.wrapEvent(
          hexToBytes(senderPrivateKey),
          { publicKey: recipientPubkey },
          bitchatBinaryContents[index], // Use BitChat binary content for this recipient
          options.conversationTitle,
          replyTo,
        );

        // TEMPORARILY DISABLED: Test without timestamp adjustment
        // TODO: Re-enable timestamp adjustment logic if needed after testing
        // BitChat filters messages older than 24 hours (86400 seconds)

        /*
        if (giftWrappedEvent.created_at < now - maxAge + 900) {
          // Add 15 min buffer
          giftWrappedEvent.created_at = now - Math.floor(Math.random() * 300); // 0-5 minutes ago

          // Re-sign the event with the new timestamp using nostr-tools
          const eventTemplate = {
            pubkey: giftWrappedEvent.pubkey,
            created_at: giftWrappedEvent.created_at,
            kind: giftWrappedEvent.kind,
            tags: giftWrappedEvent.tags,
            content: giftWrappedEvent.content,
          };

          // Use finalizeEvent to properly calculate ID and signature
          const finalizedEvent = finalizeEvent(
            eventTemplate,
            hexToBytes(senderPrivateKey),
          );

          // Update the gift-wrapped event with correct ID and signature
          giftWrappedEvent.id = finalizedEvent.id;
          giftWrappedEvent.sig = finalizedEvent.sig;
        }
        */

        return giftWrappedEvent;
      });

      console.debug(
        `🎁 Created ${giftWrappedEvents.length} gift-wrapped DM events for ${recipients.length} recipients:`,
        giftWrappedEvents.map((event, index) => ({
          index,
          recipient: recipients[index],
          eventId: event.id,
          kind: event.kind,
          pubkey: event.pubkey,
          created_at: event.created_at,
          tags: event.tags,
          contentLength: event.content.length,
        })),
      );

      // Publish all events using RelayPool
      console.debug('📡 Publishing multi-recipient DMs to relays:', {
        relays: relaysToUse,
        eventCount: giftWrappedEvents.length,
      });

      const results = await Promise.allSettled(
        giftWrappedEvents.map(async (event, index) => {
          console.debug(
            `📤 Publishing event ${index + 1}/${giftWrappedEvents.length} for recipient ${recipients[index]}`,
          );
          const publishResult = await this.pool.publish(relaysToUse, event);
          console.debug(
            `✅ Publish result for ${recipients[index]}:`,
            publishResult,
          );

          return {
            recipientPubkey: recipients[index],
            eventId: event.id,
          };
        }),
      );

      // Process results
      const processedResults = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        return {
          recipientPubkey: recipients[index],
          error: result.reason?.message || 'Failed to publish',
        };
      });

      const hasAnySuccess = processedResults.some(
        (r) => 'eventId' in r && r.eventId,
      );
      const successCount = processedResults.filter(
        (r) => 'eventId' in r && r.eventId,
      ).length;

      console.debug('📊 Multi-recipient DM send summary:', {
        totalRecipients: recipients.length,
        successCount,
        failureCount: recipients.length - successCount,
        overallSuccess: hasAnySuccess,
        results: processedResults,
      });

      return {
        success: hasAnySuccess,
        results: processedResults,
      };
    } catch (error) {
      console.error(
        'Failed to send direct messages to many recipients:',
        error,
      );

      return {
        success: false,
        results: recipients.map((pubkey) => ({
          recipientPubkey: pubkey,
          error: error instanceof Error ? error.message : 'Unknown error',
        })),
      };
    }
  }
}

/**
 * Factory function to create a DirectMessageService instance
 * Uses cryptography functions and default relays
 */
export function createDirectMessageService(
  getPrivateKeyBytes: () => Promise<PrivateKeyBytesResponse>,
  defaultRelays?: string[],
): DirectMessageService {
  return new DirectMessageService(getPrivateKeyBytes, defaultRelays);
}
