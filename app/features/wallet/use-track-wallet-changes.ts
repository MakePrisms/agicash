import { agicashRealtime } from '~/features/agicash-db/database';
import { useSupabaseRealtime } from '~/lib/supabase';
import { useLatest } from '~/lib/use-latest';
import {
  useAccountChangeHandler,
  useAccountsCache,
} from '../accounts/account-hooks';
import {
  useContactChangeHandler,
  useContactsCache,
} from '../contacts/contact-hooks';
import {
  useCashuReceiveQuoteChangeHandler,
  usePendingCashuReceiveQuotesCache,
} from '../receive/cashu-receive-quote-hooks';
import {
  useCashuTokenSwapChangeHandler,
  usePendingCashuTokenSwapsCache,
} from '../receive/cashu-token-swap-hooks';
import {
  useCashuSendQuoteChangeHandler,
  useUnresolvedCashuSendQuotesCache,
} from '../send/cashu-send-quote-hooks';
import {
  useCashuSendSwapChangeHandler,
  useUnresolvedCashuSendSwapsCache,
} from '../send/cashu-send-swap-hooks';
import {
  useTransactionChangeHandler,
  useTransactionsCache,
} from '../transactions/transaction-hooks';
import { useUser } from '../user/user-hooks';

/**
 * Payload structure from the broadcast_changes trigger function.
 */
type BroadcastChangesPayload<T = Record<string, unknown>> = {
  id: string;
  schema: string;
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  record: T | null;
  old_record: T | null;
};

type DatabaseChangeHandler = {
  table: string;
  // biome-ignore lint/suspicious/noExplicitAny: we are not sure what the payload is here. Each table handler defines the payload type.
  onInsert?: (payload: any) => void | Promise<void>;
  // biome-ignore lint/suspicious/noExplicitAny: we are not sure what the payload is here. Each table handler defines the payload type.
  onUpdate?: (newPayload: any, oldPayload: any) => void | Promise<void>;
  // biome-ignore lint/suspicious/noExplicitAny: we are not sure what the payload is here. Each table handler defines the payload type.
  onDelete?: (payload: any) => void | Promise<void>;
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

  const handleChange = useLatest((payload: BroadcastChangesPayload) => {
    const handler = handlers.find((handler) => handler.table === payload.table);
    if (!handler) return;

    if (payload.operation === 'INSERT') {
      if (!payload.record) {
        throw new Error(
          `"record" is null for INSERT operation on table: ${payload.table}`,
        );
      }
      handler.onInsert?.(payload.record);
    } else if (payload.operation === 'UPDATE') {
      if (!payload.record) {
        throw new Error(
          `"record" is null for UPDATE operation on table: ${payload.table}`,
        );
      }
      if (!payload.old_record) {
        throw new Error(
          `"old_record" is null for UPDATE operation on table: ${payload.table}`,
        );
      }
      handler.onUpdate?.(payload.record, payload.old_record);
    } else if (payload.operation === 'DELETE') {
      if (!payload.old_record) {
        throw new Error(
          `"old_record" is null for DELETE operation on table: ${payload.table}`,
        );
      }
      handler.onDelete?.(payload.old_record);
    }
  });

  const userId = useUser((user) => user.id);

  useSupabaseRealtime({
    channel: agicashRealtime
      .channel(`wallet:${userId}`, { private: true })
      .on<BroadcastChangesPayload>(
        'broadcast',
        { event: 'INSERT' },
        ({ payload }) => handleChange.current(payload),
      )
      .on<BroadcastChangesPayload>(
        'broadcast',
        { event: 'UPDATE' },
        ({ payload }) => handleChange.current(payload),
      )
      .on<BroadcastChangesPayload>(
        'broadcast',
        { event: 'DELETE' },
        ({ payload }) => handleChange.current(payload),
      ),
    onConnected: () => {
      onConnectedRef.current?.();
    },
  });
}

export const useTrackWalletChanges = () => {
  const accountChangeHandler = useAccountChangeHandler();
  const transactionChangeHandler = useTransactionChangeHandler();
  const cashuReceiveQuoteChangeHandler = useCashuReceiveQuoteChangeHandler();
  const cashuTokenSwapChangeHandler = useCashuTokenSwapChangeHandler();
  const cashuSendQuoteChangeHandler = useCashuSendQuoteChangeHandler();
  const cashuSendSwapChangeHandler = useCashuSendSwapChangeHandler();
  const contactChangeHandler = useContactChangeHandler();

  const accountsCache = useAccountsCache();
  const transactionsCache = useTransactionsCache();
  const pendingCashuReceiveQuotesCache = usePendingCashuReceiveQuotesCache();
  const pendingCashuTokenSwapsCache = usePendingCashuTokenSwapsCache();
  const unresolvedCashuSendQuotesCache = useUnresolvedCashuSendQuotesCache();
  const unresolvedCashuSendSwapsCache = useUnresolvedCashuSendSwapsCache();
  const contactsCache = useContactsCache();

  useTrackDatabaseChanges({
    handlers: [
      accountChangeHandler,
      transactionChangeHandler,
      cashuReceiveQuoteChangeHandler,
      cashuTokenSwapChangeHandler,
      cashuSendQuoteChangeHandler,
      cashuSendSwapChangeHandler,
      contactChangeHandler,
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
