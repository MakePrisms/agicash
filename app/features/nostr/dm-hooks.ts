import type { PrivateKeyBytesResponse } from '@opensecret/react';
import { useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCryptography } from '~/features/shared/cryptography';
import {
  type DirectMessageService,
  createDirectMessageService,
} from './dm-service';

/**
 * Hook to get the DirectMessageService instance
 * Memoized to prevent recreation on every render
 */
export function useDirectMessageService(
  privateKey?: string,
): DirectMessageService {
  const { getPrivateKeyBytes } = useCryptography();

  return useMemo(() => {
    if (privateKey) {
      // Use the provided private key (from demo page)
      const getPrivateKeyFromDemo =
        async (): Promise<PrivateKeyBytesResponse> => ({
          private_key: privateKey,
        });
      return createDirectMessageService(getPrivateKeyFromDemo);
    }
    // Fall back to cryptography service
    return createDirectMessageService(getPrivateKeyBytes);
  }, [getPrivateKeyBytes, privateKey]);
}

/**
 * Hook to send a direct message to a single recipient
 * Returns a mutation that can be used to send DMs with loading states
 */
export function useSendDirectMessage(privateKey: string) {
  const dmService = useDirectMessageService(privateKey);

  return useMutation({
    mutationFn: async ({
      recipientPubkey,
      message,
      options = {},
    }: {
      recipientPubkey: string;
      message: string;
      options?: {
        replyToEventId?: string;
        replyRelayUrl?: string;
        conversationTitle?: string;
        relayUrls?: string[];
      };
    }) => {
      const result = await dmService.sendDirectMessage(
        recipientPubkey,
        message,
        options,
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to send direct message');
      }

      return result;
    },
    onSuccess: (result) => {
      console.log('Direct message sent successfully:', result.eventId);
    },
    onError: (error) => {
      console.error('Failed to send direct message:', error);
    },
  });
}

/**
 * Hook to send a direct message to multiple recipients
 * Returns a mutation for sending DMs to multiple people at once
 */
export function useSendDirectMessageToMany() {
  const dmService = useDirectMessageService();

  return useMutation({
    mutationFn: async ({
      recipients,
      message,
      options = {},
    }: {
      recipients: string[];
      message: string;
      options?: {
        replyToEventId?: string;
        replyRelayUrl?: string;
        conversationTitle?: string;
        relayUrls?: string[];
      };
    }) => {
      const result = await dmService.sendDirectMessageToMany(
        recipients,
        message,
        options,
      );

      if (!result.success) {
        const errorMessages = result.results
          .filter((r) => r.error)
          .map((r) => `${r.recipientPubkey}: ${r.error}`)
          .join(', ');
        throw new Error(errorMessages || 'Failed to send direct messages');
      }

      return result;
    },
    onSuccess: (result) => {
      const successCount = result.results.filter((r) => r.eventId).length;
      console.log(
        `Direct messages sent successfully to ${successCount}/${result.results.length} recipients`,
      );
    },
    onError: (error) => {
      console.error(
        'Failed to send direct messages to multiple recipients:',
        error,
      );
    },
  });
}
