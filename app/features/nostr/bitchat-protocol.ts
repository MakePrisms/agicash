/**
 * BitChat Protocol utilities for message formatting and parsing
 * Integrates with Nostr NIP-17 encrypted messages
 */

import { sha256 } from '@noble/hashes/sha256';

/**
 * Generate a unique message ID for BitChat protocol
 * Uses browser-compatible crypto.getRandomValues for random bytes generation
 * @returns A 16-character hex string for message identification
 */
export function generateMessageId(): string {
  // Generate 8 random bytes using browser-compatible crypto
  const randomBytes = new Uint8Array(8);
  if (
    typeof window !== 'undefined' &&
    window.crypto &&
    window.crypto.getRandomValues
  ) {
    window.crypto.getRandomValues(randomBytes);
  } else if (
    typeof globalThis !== 'undefined' &&
    globalThis.crypto &&
    globalThis.crypto.getRandomValues
  ) {
    globalThis.crypto.getRandomValues(randomBytes);
  } else {
    // Fallback for environments without crypto.getRandomValues
    for (let i = 0; i < randomBytes.length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Convert to hex string
  return Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert a Nostr pubkey to a BitChat peer ID
 * Derives peer ID by SHA256 hashing the pubkey and taking first 16 hex chars (matching BitChat's PeerIDUtils.derivePeerID)
 * @param pubkey - 32-byte hex public key
 * @returns 16-character peer ID
 */
export function pubkeyToPeerId(pubkey: string): string {
  if (pubkey.length !== 64) {
    throw new Error('Invalid pubkey length, expected 64 hex characters');
  }

  // Convert hex pubkey to bytes
  const pubkeyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const hex = pubkey.substring(i * 2, i * 2 + 2);
    pubkeyBytes[i] = Number.parseInt(hex, 16);
  }

  // SHA256 hash the pubkey bytes (matching BitChat's PeerIDUtils.derivePeerID)
  const hashBytes = sha256(pubkeyBytes);

  // Convert to hex and take first 16 characters (8 bytes)
  const hashHex = Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 16);

  return hashHex;
}

/**
 * Format a message content with BitChat protocol wrapper for private messages
 * @param messageId - Unique message identifier
 * @param recipientPeerId - Recipient's peer ID (derived from pubkey)
 * @param senderPeerId - Sender's peer ID (derived from pubkey)
 * @param content - The actual message content
 * @returns Formatted message string with BitChat protocol prefix
 */
export function formatPrivateMessage(
  messageId: string,
  recipientPeerId: string,
  senderPeerId: string,
  content: string,
): string {
  return `[BITCHAT:PM]:${messageId}:${recipientPeerId}:${senderPeerId}:${content}`;
}

/**
 * Format a read acknowledgment message
 * @param originalMessageId - ID of the message being acknowledged
 * @param senderPeerId - Peer ID of the original sender
 * @returns Formatted read acknowledgment string
 */
export function formatReadAck(
  originalMessageId: string,
  senderPeerId: string,
): string {
  return `[BITCHAT:ACK:READ]:${originalMessageId}:${senderPeerId}`;
}

/**
 * Format a delivery acknowledgment message
 * @param originalMessageId - ID of the message being acknowledged
 * @param senderPeerId - Peer ID of the original sender
 * @returns Formatted delivery acknowledgment string
 */
export function formatDeliveryAck(
  originalMessageId: string,
  senderPeerId: string,
): string {
  return `[BITCHAT:ACK:DELIVERED]:${originalMessageId}:${senderPeerId}`;
}

/**
 * Parse a BitChat protocol message to extract components
 * @param content - The BitChat formatted message string
 * @returns Parsed message components or null if not a valid BitChat message
 */
export function parseBitchatMessage(content: string): {
  type: 'PM' | 'ACK:READ' | 'ACK:DELIVERED';
  messageId: string;
  recipientPeerId?: string;
  senderPeerId: string;
  content?: string;
  originalMessageId?: string;
} | null {
  if (!content.startsWith('[BITCHAT:')) {
    return null;
  }

  // Private message: [BITCHAT:PM]:messageID:recipient_peer_id:sender_peer_id:content
  if (content.startsWith('[BITCHAT:PM]:')) {
    const parts = content.slice('[BITCHAT:PM]:'.length).split(':');
    if (parts.length < 4) return null;

    const [messageId, recipientPeerId, senderPeerId, ...contentParts] = parts;
    return {
      type: 'PM',
      messageId,
      recipientPeerId,
      senderPeerId,
      content: contentParts.join(':'), // Rejoin in case content had colons
    };
  }

  // Read acknowledgment: [BITCHAT:ACK:READ]:original_message_id:sender_peer_id
  if (content.startsWith('[BITCHAT:ACK:READ]:')) {
    const parts = content.slice('[BITCHAT:ACK:READ]:'.length).split(':');
    if (parts.length < 2) return null;

    const [originalMessageId, senderPeerId] = parts;
    return {
      type: 'ACK:READ',
      messageId: '', // Not applicable for acks
      senderPeerId,
      originalMessageId,
    };
  }

  // Delivery acknowledgment: [BITCHAT:ACK:DELIVERED]:original_message_id:sender_peer_id
  if (content.startsWith('[BITCHAT:ACK:DELIVERED]:')) {
    const parts = content.slice('[BITCHAT:ACK:DELIVERED]:'.length).split(':');
    if (parts.length < 2) return null;

    const [originalMessageId, senderPeerId] = parts;
    return {
      type: 'ACK:DELIVERED',
      messageId: '', // Not applicable for acks
      senderPeerId,
      originalMessageId,
    };
  }

  return null;
}

/**
 * Check if a message content is a BitChat protocol message
 * @param content - Message content to check
 * @returns True if the content follows BitChat protocol format
 */
export function isBitchatMessage(content: string): boolean {
  return content.startsWith('[BITCHAT:');
}

/**
 * Normalize peer ID input (matching BitChat's normalizeRecipientPeerID function)
 * Handles both full 64-character pubkeys and 16-character peer IDs
 * @param peerIdOrPubkey - Either a 16-char peer ID or 64-char pubkey
 * @returns 16-character peer ID
 */
function normalizePeerID(peerIdOrPubkey: string): string {
  if (peerIdOrPubkey.length === 64) {
    // Treat as full pubkey - derive peer ID using SHA256 hash
    return pubkeyToPeerId(peerIdOrPubkey);
  }
  if (peerIdOrPubkey.length === 16) {
    // Already a peer ID
    return peerIdOrPubkey;
  }
  // Fallback: return as-is (should be 16 hex chars)
  return peerIdOrPubkey.padEnd(16, '0').substring(0, 16);
}

/**
 * Create a BitChat binary packet in the format that BitChat expects for Nostr DMs
 * This creates the `bitchat1:` + base64url encoded format that BitChat requires
 * @param messageId - Unique message identifier
 * @param recipientPeerIdOrPubkey - Recipient's peer ID (16 chars) or full pubkey (64 chars)
 * @param senderPeerIdOrPubkey - Sender's peer ID (16 chars) or full pubkey (64 chars)
 * @param content - The actual message content
 * @param _senderNoiseKey - Optional sender's Noise public key for better recognition
 * @returns BitChat binary packet format string
 */
export function createBitchatBinaryPacket(
  messageId: string,
  recipientPeerIdOrPubkey: string,
  senderPeerIdOrPubkey: string,
  content: string,
  _senderNoiseKey?: string,
): string {
  // Create TLV-encoded private message packet matching BitChat's PrivateMessagePacket structure
  const pmPacket = createPrivateMessagePacket(messageId, content);

  // Create payload with NoisePayloadType.privateMessage prefix (0x01)
  const payload = new Uint8Array(1 + pmPacket.length);
  payload[0] = 0x01; // NoisePayloadType.privateMessage
  payload.set(pmPacket, 1);

  // Normalize peer IDs (handle both full pubkeys and peer IDs like BitChat does)
  const normalizedRecipientPeerId = normalizePeerID(recipientPeerIdOrPubkey);
  const normalizedSenderPeerId = normalizePeerID(senderPeerIdOrPubkey);

  // Convert peer IDs to 8-byte Data (matching BitChat's format)
  const senderIdBytes = createPeerIdBytes(normalizedSenderPeerId);
  const recipientIdBytes = createPeerIdBytes(normalizedRecipientPeerId);

  // Create BitChat packet following exact structure from BinaryProtocol.swift
  // Fixed header: version(1) + type(1) + ttl(1) + timestamp(8) + flags(1) + payloadLength(2) = 14 bytes
  // Variable fields: senderID(8) + recipientID(8 if hasRecipient) + payload

  // Calculate total size correctly based on BitChat's BinaryProtocol.encode method
  const fixedHeaderSize = 14; // version(1) + type(1) + ttl(1) + timestamp(8) + flags(1) + payloadLength(2)
  const senderIdSize = 8;
  const recipientIdSize = 8; // Always 8 bytes when hasRecipient flag is set
  const totalSize =
    fixedHeaderSize + senderIdSize + recipientIdSize + payload.length;

  const fullPacket = new Uint8Array(totalSize);
  let offset = 0;

  console.debug('🔧 Creating BitChat packet (corrected):', {
    fixedHeaderSize,
    senderIdSize,
    recipientIdSize,
    payloadSize: payload.length,
    calculatedTotalSize: totalSize,
    allocatedSize: fullPacket.length,
  });

  // Fixed header (14 bytes) - using big-endian per BitChat's BinaryProtocol.swift
  fullPacket[offset++] = 1; // version
  fullPacket[offset++] = 0x11; // MessageType.noiseEncrypted (0x11 from BitchatProtocol.swift)
  fullPacket[offset++] = 7; // TTL

  // Timestamp (8 bytes, big-endian) - milliseconds since epoch
  const timestamp = BigInt(Date.now());
  for (let i = 7; i >= 0; i--) {
    fullPacket[offset++] = Number((timestamp >> BigInt(i * 8)) & 0xffn);
  }

  // Flags byte: hasRecipient(0x01) flag set since we have a recipient
  fullPacket[offset++] = 0x01; // hasRecipient flag

  // Payload length (2 bytes, big-endian) - this is ONLY the payload size, not including sender/recipient IDs
  fullPacket[offset++] = (payload.length >> 8) & 0xff;
  fullPacket[offset++] = payload.length & 0xff;

  console.debug(
    '📏 After fixed header (14 bytes), offset:',
    offset,
    'should be 14:',
    offset === 14,
  );

  // Variable fields follow immediately after header
  // SenderID (8 bytes)
  console.debug('🔧 Setting sender ID at offset:', offset);
  fullPacket.set(senderIdBytes, offset);
  offset += senderIdSize;

  // RecipientID (8 bytes) - only present when hasRecipient flag is set
  console.debug('🔧 Setting recipient ID at offset:', offset);
  fullPacket.set(recipientIdBytes, offset);
  offset += recipientIdSize;

  // Payload
  console.debug(
    '🔧 Setting payload at offset:',
    offset,
    'payload size:',
    payload.length,
  );
  fullPacket.set(payload, offset);

  console.debug('✅ BitChat-compatible binary packet created:', {
    messageId,
    senderPeerId: normalizedSenderPeerId,
    recipientPeerId: normalizedRecipientPeerId,
    contentLength: content.length,
    payloadLength: payload.length,
    totalPacketSize: fullPacket.length,
    timestamp: Number(timestamp),
  });

  // Convert to base64url and add bitchat1: prefix (matching BitChat's format)
  return `bitchat1:${base64URLEncode(fullPacket)}`;
}

/**
 * Create a TLV-encoded PrivateMessagePacket matching BitChat's Packets.swift structure
 * @param messageID - Message identifier
 * @param content - Message content
 * @returns Encoded TLV data
 */
function createPrivateMessagePacket(
  messageID: string,
  content: string,
): Uint8Array {
  // TLV encoding per BitChat's PrivateMessagePacket.encode()
  // TLVType.messageID = 0x00, TLVType.content = 0x01
  const messageIDBytes = new TextEncoder().encode(messageID);
  const contentBytes = new TextEncoder().encode(content);

  // Check length limits (BitChat enforces 255 byte max per TLV value)
  if (messageIDBytes.length > 255 || contentBytes.length > 255) {
    throw new Error('MessageID or content too long for BitChat TLV encoding');
  }

  // TLV: Type(1) + Length(1) + Value(variable)
  const tlvData = new Uint8Array(
    1 +
      1 +
      messageIDBytes.length + // messageID TLV
      1 +
      1 +
      contentBytes.length, // content TLV
  );
  let offset = 0;

  // MessageID TLV
  tlvData[offset++] = 0x00; // TLVType.messageID
  tlvData[offset++] = messageIDBytes.length;
  tlvData.set(messageIDBytes, offset);
  offset += messageIDBytes.length;

  // Content TLV
  tlvData[offset++] = 0x01; // TLVType.content
  tlvData[offset++] = contentBytes.length;
  tlvData.set(contentBytes, offset);

  return tlvData;
}

/**
 * Convert peer ID to 8-byte Data matching BitChat's format
 * @param peerID - 16-character hex peer ID
 * @returns 8-byte Uint8Array
 */
function createPeerIdBytes(peerID: string): Uint8Array {
  // Ensure peerID is exactly 16 hex chars (8 bytes)
  const normalizedPeerID = peerID.padEnd(16, '0').substring(0, 16);

  console.debug('🔧 Creating peer ID bytes:', {
    originalPeerID: peerID,
    normalizedPeerID,
    normalizedLength: normalizedPeerID.length,
  });

  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    const hex = normalizedPeerID.substring(i * 2, i * 2 + 2);
    const byte = Number.parseInt(hex, 16) || 0;
    bytes[i] = byte;
    console.debug(`  Byte ${i}: hex="${hex}" -> ${byte}`);
  }

  console.debug('✅ Peer ID bytes created:', Array.from(bytes));
  return bytes;
}

/**
 * Base64url encode data (without padding)
 * @param data - Data to encode
 * @returns Base64url encoded string
 */
function base64URLEncode(data: Uint8Array): string {
  // Convert Uint8Array to regular array for btoa
  const bytes = Array.from(data);
  const base64 = btoa(String.fromCharCode(...bytes));

  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
