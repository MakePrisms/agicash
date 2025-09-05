import { hexToBytes } from '@noble/hashes/utils';
import { mapEventsToStore } from 'applesauce-core';

import { getTagValue } from 'applesauce-core/helpers';
import { TimelineModel } from 'applesauce-core/models';
import { useEventStore, useObservableMemo } from 'applesauce-react/hooks';
import { RelayPool, onlyEvents } from 'applesauce-relay';
import type { Filter, NostrEvent } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools';
import { useEffect, useRef, useState } from 'react';
import { Chat, type ChatMessage } from '~/components/chat';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { useNostrCryptography } from '~/features/shared/nostr';
import { useUser } from '~/features/user/user-hooks';
import { useRelaySelection } from '~/hooks/use-relay-selection';
import { cashuTokenRegex, extractCashuToken } from '~/lib/cashu';
import type { Route } from './+types/_protected.chat.$geoHash';

// RelayPool instance for nostr connections
const pool = new RelayPool();

export default function ChatPage({ params }: Route.ComponentProps) {
  const geohash = params.geoHash;
  const eventStore = useEventStore();
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const username = useUser((s) => s.username);
  const relayUrls = useRelaySelection(geohash).closestRelays.map(
    (relay) => relay.url,
  );

  const { getPrivateKey } = useNostrCryptography();

  // Get timeline events from eventStore
  const timeline = useObservableMemo(
    () => eventStore.model(TimelineModel, { kinds: [20000], '#g': [geohash] }),
    [],
  );

  // Convert nostr events to ChatMessage format
  // Reverse the timeline so newest messages appear at bottom (chat-style)
  const messages: ChatMessage[] = (timeline?.slice().reverse() || []).map(
    (event: NostrEvent) => {
      const username = getTagValue(event, 'n') || event.pubkey.slice(0, 6);
      const token = extractCashuToken(event.content);

      // Remove token from content if one was found
      const content = token
        ? event.content.replace(cashuTokenRegex, '').trim()
        : event.content;

      return {
        id: event.id,
        username,
        content,
        pubkey: event.pubkey,
        token,
      };
    },
  );

  // Set up nostr subscription for kind 20000 events with geohash filter
  useEffect(() => {
    // Clean up previous subscription
    subscriptionRef.current?.unsubscribe();

    const filter: Filter = {
      kinds: [20000],
      '#g': [geohash],
    };

    const subscription = pool
      .group(relayUrls)
      .subscription(filter)
      .pipe(onlyEvents(), mapEventsToStore(eventStore))
      .subscribe({
        next: (event) =>
          console.log('Event:', {
            tags: event.tags,
            content: event.content,
            event,
          }),
        error: (err) => console.error('Relay error:', err),
        complete: () => console.log('Subscription complete'),
      });

    subscriptionRef.current = subscription;

    return () => {
      subscription.unsubscribe();
    };
  }, [eventStore, geohash, relayUrls]);

  const handleSendMessage = async (message: string) => {
    if (!message.trim() || isSending) return;

    const privateKey = await getPrivateKey();

    setIsSending(true);
    try {
      const eventTemplate = {
        kind: 20000,
        content: message.trim(),
        tags: [
          ['g', geohash],
          ['n', username],
          ['t', 'teleport'], // signals that we are not actually located in this geohash, we teleported to it
          // ['client', 'agicash']
        ] as string[][],
        created_at: Math.floor(Date.now() / 1000),
      };

      const signedEvent = finalizeEvent(eventTemplate, hexToBytes(privateKey));

      const publishResults = await pool.publish(relayUrls, signedEvent);

      console.debug('✅ Published message to relays:', publishResults);
    } catch (error) {
      console.error('❌ Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Page>
      <PageHeader>
        <ClosePageButton
          to="/settings"
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>{geohash}📍</PageHeaderTitle>
      </PageHeader>
      <PageContent className="gap-0 overflow-hidden p-0">
        <Chat
          messages={messages}
          onSendMessage={handleSendMessage}
          placeholder={`Send a message to ${geohash}...`}
          className="h-full"
        />
      </PageContent>
    </Page>
  );
}
