import { useSdk } from '@agicash/react-wallet-sdk';
import { agicashRealtimeClient } from '~/features/agicash-db/database.client';
import { useSupabaseRealtime } from '~/lib/supabase';
import { useLatest } from '~/lib/use-latest';
import {
  useContactChangeHandlers,
  useContactsCache,
} from '../contacts/contact-hooks';
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
import {
  useCashuSendQuoteChangeHandlers,
  useUnresolvedCashuSendQuotesCache,
} from '../send/cashu-send-quote-hooks';
import {
  useCashuSendSwapCache,
  useCashuSendSwapChangeHandlers,
  useUnresolvedCashuSendSwapsCache,
} from '../send/cashu-send-swap-hooks';
import {
  useSparkSendQuoteChangeHandlers,
  useUnresolvedSparkSendQuotesCache,
} from '../send/spark-send-quote-hooks';
import {
  useTransactionChangeHandlers,
  useTransactionsCache,
} from '../transactions/transaction-hooks';
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
  const sdk = useSdk();
  const transactionChangeHandlers = useTransactionChangeHandlers();
  const cashuReceiveQuoteChangeHandlers = useCashuReceiveQuoteChangeHandlers();
  const cashuReceiveSwapChangeHandlers = useCashuReceiveSwapChangeHandlers();
  const cashuSendQuoteChangeHandlers = useCashuSendQuoteChangeHandlers();
  const cashuSendSwapChangeHandlers = useCashuSendSwapChangeHandlers();
  const contactChangeHandlers = useContactChangeHandlers();
  const sparkReceiveQuoteChangeHandlers = useSparkReceiveQuoteChangeHandlers();
  const sparkSendQuoteChangeHandlers = useSparkSendQuoteChangeHandlers();

  const transactionsCache = useTransactionsCache();
  const cashuReceiveQuoteCache = useCashuReceiveQuoteCache();
  const pendingCashuReceiveQuotesCache = usePendingCashuReceiveQuotesCache();
  const pendingCashuReceiveSwapsCache = usePendingCashuReceiveSwapsCache();
  const unresolvedCashuSendQuotesCache = useUnresolvedCashuSendQuotesCache();
  const cashuSendSwapCache = useCashuSendSwapCache();
  const unresolvedCashuSendSwapsCache = useUnresolvedCashuSendSwapsCache();
  const contactsCache = useContactsCache();
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();
  const pendingSparkReceiveQuotesCache = usePendingSparkReceiveQuotesCache();
  const unresolvedSparkSendQuotesCache = useUnresolvedSparkSendQuotesCache();

  // Account and user change handlers: refetch the SDK's reactive queries so
  // useQ(sdk.accounts.list()) and useQ(sdk.user.getCurrentUser()) subscribers
  // see the new data. SDK background (PR8d) will own this long-term; for PR8b
  // we drive it off the same web Supabase realtime channel.
  const accountChangeHandlers: DatabaseChangeHandler[] = [
    {
      event: 'ACCOUNT_CREATED',
      handleEvent: () => {
        void sdk.accounts.list().refetch();
      },
    },
    {
      event: 'ACCOUNT_UPDATED',
      handleEvent: () => {
        void sdk.accounts.list().refetch();
      },
    },
  ];

  const userChangeHandlers: DatabaseChangeHandler[] = [
    {
      event: 'USER_UPDATED',
      handleEvent: () => {
        void sdk.user.getCurrentUser().refetch();
      },
    },
  ];

  useTrackDatabaseChanges({
    handlers: [
      ...accountChangeHandlers,
      ...transactionChangeHandlers,
      ...cashuReceiveQuoteChangeHandlers,
      ...cashuReceiveSwapChangeHandlers,
      ...cashuSendQuoteChangeHandlers,
      ...cashuSendSwapChangeHandlers,
      ...contactChangeHandlers,
      ...sparkReceiveQuoteChangeHandlers,
      ...sparkSendQuoteChangeHandlers,
      ...userChangeHandlers,
    ],
    onConnected: () => {
      // Refetch SDK reactive reads on reconnect to catch any missed updates.
      void sdk.accounts.list().refetch();
      void sdk.user.getCurrentUser().refetch();
      // Invalidate the web TanStack caches for the other features.
      transactionsCache.invalidate();
      cashuReceiveQuoteCache.invalidate();
      pendingCashuReceiveQuotesCache.invalidate();
      pendingCashuReceiveSwapsCache.invalidate();
      unresolvedCashuSendQuotesCache.invalidate();
      cashuSendSwapCache.invalidate();
      unresolvedCashuSendSwapsCache.invalidate();
      contactsCache.invalidate();
      sparkReceiveQuoteCache.invalidate();
      pendingSparkReceiveQuotesCache.invalidate();
      unresolvedSparkSendQuotesCache.invalidate();
    },
  });
};
