import { agicashRealtimeClient } from '~/features/agicash-db/database.client';
import { useSupabaseRealtime } from '~/lib/supabase';
import { useLatest } from '~/lib/use-latest';
import {
  useContactChangeHandlers,
  useContactsCache,
} from '../contacts/contact-hooks';
import { useUser } from '../user/user-hooks';
import { useWalletClient } from '../wallet/wallet-client';

type DatabaseChangeHandler = {
  event: string;
  // biome-ignore lint/suspicious/noExplicitAny: we are not sure what the payload is here. Each table handler defines the payload type.
  handleEvent: (payload: any) => void | Promise<void>;
};

/**
 * Options for the track database changes hook.
 */
interface Props {
  /**
   * The handlers for the database changes.
   * Each handler is responsible for handling the changes for a specific table.
   */
  handlers: DatabaseChangeHandler[];
  /**
   * A callback that is called when the channel is initially connected or reconnected.
   */
  onConnected?: () => void;
}

/**
 * Hook that subscribes to all database changes for the wallet using a single broadcast channel.
 * This centralizes all realtime subscriptions into one channel for better scalability.
 */
function useTrackDatabaseChanges({ handlers, onConnected }: Props) {
  const onConnectedRef = useLatest(onConnected);

  const userId = useUser((user) => user.id);

  useSupabaseRealtime({
    channel: agicashRealtimeClient
      .channel(`wallet:${userId}`, { private: true })
      .on('broadcast', { event: '*' }, ({ event, payload }) => {
        const handler = handlers.find((handler) => handler.event === event);
        handler?.handleEvent(payload);
      }),
    onConnected: () => {
      onConnectedRef.current?.();
    },
  });
}

export const useTrackWalletChanges = () => {
  const wallet = useWalletClient();
  const contactChangeHandlers = useContactChangeHandlers();
  const contactsCache = useContactsCache();

  useTrackDatabaseChanges({
    handlers: [...wallet.changeHandlers, ...contactChangeHandlers],
    onConnected: () => {
      // The web app does not use RealtimeHandler — it manages its own channel
      // via useSupabaseRealtime. These invalidations are needed here because
      // onConnected fires when the web app's channel reconnects.
      wallet.caches.accounts.invalidate();
      wallet.caches.transactions.invalidate();
      wallet.caches.cashuReceiveQuote.invalidate();
      wallet.caches.pendingCashuReceiveQuotes.invalidate();
      wallet.caches.pendingCashuReceiveSwaps.invalidate();
      wallet.caches.unresolvedCashuSendQuotes.invalidate();
      wallet.caches.cashuSendSwap.invalidate();
      wallet.caches.unresolvedCashuSendSwaps.invalidate();
      wallet.caches.sparkReceiveQuote.invalidate();
      wallet.caches.pendingSparkReceiveQuotes.invalidate();
      wallet.caches.unresolvedSparkSendQuotes.invalidate();
      contactsCache.invalidate();
    },
  });
};
