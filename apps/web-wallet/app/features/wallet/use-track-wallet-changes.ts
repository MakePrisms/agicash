import { agicashRealtimeClient } from '~/features/agicash-db/database.client';
import { useSupabaseRealtime } from '~/lib/supabase';
import { useLatest } from '~/lib/use-latest';
import {
  useCashuReceiveQuoteCache,
  useCashuReceiveQuoteChangeHandlers,
  usePendingCashuReceiveQuotesCache,
} from '../receive/cashu-receive-quote-hooks';
import {
  useCashuReceiveSwapChangeHandlers,
  usePendingCashuReceiveSwapsCache,
} from '../receive/cashu-receive-swap-hooks';
import {
  usePendingSparkReceiveQuotesCache,
  useSparkReceiveQuoteCache,
  useSparkReceiveQuoteChangeHandlers,
} from '../receive/spark-receive-quote-hooks';
import { useUser } from '../user/user-hooks';

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
  const cashuReceiveQuoteChangeHandlers = useCashuReceiveQuoteChangeHandlers();
  const cashuReceiveSwapChangeHandlers = useCashuReceiveSwapChangeHandlers();
  const sparkReceiveQuoteChangeHandlers = useSparkReceiveQuoteChangeHandlers();

  const cashuReceiveQuoteCache = useCashuReceiveQuoteCache();
  const pendingCashuReceiveQuotesCache = usePendingCashuReceiveQuotesCache();
  const pendingCashuReceiveSwapsCache = usePendingCashuReceiveSwapsCache();
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();
  const pendingSparkReceiveQuotesCache = usePendingSparkReceiveQuotesCache();

  useTrackDatabaseChanges({
    handlers: [
      ...cashuReceiveQuoteChangeHandlers,
      ...cashuReceiveSwapChangeHandlers,
      ...sparkReceiveQuoteChangeHandlers,
    ],
    onConnected: () => {
      // Makes sure that data is refetched to get the latest updates from the database.
      // This handles possibly missed updates while the realtime was not connected yet
      // or while it was reconnecting.
      cashuReceiveQuoteCache.invalidate();
      pendingCashuReceiveQuotesCache.invalidate();
      pendingCashuReceiveSwapsCache.invalidate();
      sparkReceiveQuoteCache.invalidate();
      pendingSparkReceiveQuotesCache.invalidate();
    },
  });
};
