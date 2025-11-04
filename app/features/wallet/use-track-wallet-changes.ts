import { agicashRealtime } from '~/features/agicash-db/database';
import { useSupabaseRealtime } from '~/lib/supabase';
import { useLatest } from '~/lib/use-latest';
import {
  useAccountChangeHandlers,
  useAccountsCache,
} from '../accounts/account-hooks';
import {
  useContactChangeHandlers,
  useContactsCache,
} from '../contacts/contact-hooks';
import {
  useCashuReceiveQuoteChangeHandlers,
  usePendingCashuReceiveQuotesCache,
} from '../receive/cashu-receive-quote-hooks';
import {
  useCashuTokenSwapChangeHandlers,
  usePendingCashuTokenSwapsCache,
} from '../receive/cashu-token-swap-hooks';
import {
  useCashuSendQuoteChangeHandlers,
  useUnresolvedCashuSendQuotesCache,
} from '../send/cashu-send-quote-hooks';
import {
  useCashuSendSwapChangeHandlers,
  useUnresolvedCashuSendSwapsCache,
} from '../send/cashu-send-swap-hooks';
import { useTrackAndUpdateSparkBalance } from '../shared/spark';
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
    channel: agicashRealtime
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
  const accountChangeHandlers = useAccountChangeHandlers();
  const transactionChangeHandlers = useTransactionChangeHandlers();
  const cashuReceiveQuoteChangeHandlers = useCashuReceiveQuoteChangeHandlers();
  const cashuTokenSwapChangeHandlers = useCashuTokenSwapChangeHandlers();
  const cashuSendQuoteChangeHandlers = useCashuSendQuoteChangeHandlers();
  const cashuSendSwapChangeHandlers = useCashuSendSwapChangeHandlers();
  const contactChangeHandlers = useContactChangeHandlers();

  const accountsCache = useAccountsCache();
  const transactionsCache = useTransactionsCache();
  const pendingCashuReceiveQuotesCache = usePendingCashuReceiveQuotesCache();
  const pendingCashuTokenSwapsCache = usePendingCashuTokenSwapsCache();
  const unresolvedCashuSendQuotesCache = useUnresolvedCashuSendQuotesCache();
  const unresolvedCashuSendSwapsCache = useUnresolvedCashuSendSwapsCache();
  const contactsCache = useContactsCache();

  useTrackAndUpdateSparkBalance();

  useTrackDatabaseChanges({
    handlers: [
      ...accountChangeHandlers,
      ...transactionChangeHandlers,
      ...cashuReceiveQuoteChangeHandlers,
      ...cashuTokenSwapChangeHandlers,
      ...cashuSendQuoteChangeHandlers,
      ...cashuSendSwapChangeHandlers,
      ...contactChangeHandlers,
    ],
    onConnected: () => {
      // Makes sure that data is refetched to get the latest updates from the database.
      // This handles possibly missed updates while the realtime was not connected yet
      // or while it was reconnecting.
      accountsCache.invalidate();
      transactionsCache.invalidate();
      pendingCashuReceiveQuotesCache.invalidate();
      pendingCashuTokenSwapsCache.invalidate();
      unresolvedCashuSendQuotesCache.invalidate();
      unresolvedCashuSendSwapsCache.invalidate();
      contactsCache.invalidate();
    },
  });
};
