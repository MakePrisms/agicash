import type { WalletEventMap } from '@agicash/wallet-sdk';
import { useEffect, useState } from 'react';
import { sdk } from '~/features/shared/sdk.client';
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
  useCashuReceiveQuoteCache,
  useCashuReceiveQuoteChangeHandlers,
} from '../receive/cashu-receive-quote-hooks';
import {
  useSparkReceiveQuoteCache,
  useSparkReceiveQuoteChangeHandlers,
} from '../receive/spark-receive-quote-hooks';
import {
  useCashuSendSwapCache,
  useCashuSendSwapChangeHandlers,
} from '../send/cashu-send-swap-hooks';
import {
  useTransactionChangeHandlers,
  useTransactionsCache,
} from '../transactions/transaction-hooks';
import { useUserCache, useUserChangeHandlers } from '../user/user-hooks';
import { SupabaseRealtimeError } from './supabase-realtime-error';

export type WalletChangeHandlers<K extends keyof WalletEventMap> = {
  [E in K]: (payload: WalletEventMap[E]) => void;
};

type FeedEvent =
  | 'user.updated'
  | 'account.created'
  | 'account.updated'
  | 'contact.created'
  | 'contact.deleted'
  | 'transaction.created'
  | 'transaction.updated'
  | 'cashu-receive-quote.created'
  | 'cashu-receive-quote.updated'
  | 'cashu-receive-swap.created'
  | 'cashu-receive-swap.updated'
  | 'spark-receive-quote.created'
  | 'spark-receive-quote.updated'
  | 'cashu-send-quote.created'
  | 'cashu-send-quote.updated'
  | 'cashu-send-swap.created'
  | 'cashu-send-swap.updated'
  | 'spark-send-quote.created'
  | 'spark-send-quote.updated';

type SagaOnlyEvent =
  | 'cashu-receive-swap.created'
  | 'cashu-receive-swap.updated'
  | 'cashu-receive-quote.created'
  | 'cashu-send-swap.created'
  | 'spark-send-quote.created'
  | 'spark-send-quote.updated'
  | 'cashu-send-quote.created'
  | 'cashu-send-quote.updated'
  | 'spark-receive-quote.created';

export const useTrackWalletChanges = () => {
  const accountChangeHandlers = useAccountChangeHandlers();
  const transactionChangeHandlers = useTransactionChangeHandlers();
  const cashuReceiveQuoteChangeHandlers = useCashuReceiveQuoteChangeHandlers();
  const cashuSendSwapChangeHandlers = useCashuSendSwapChangeHandlers();
  const contactChangeHandlers = useContactChangeHandlers();
  const sparkReceiveQuoteChangeHandlers = useSparkReceiveQuoteChangeHandlers();
  const userChangeHandlers = useUserChangeHandlers();

  const accountsCache = useAccountsCache();
  const transactionsCache = useTransactionsCache();
  const cashuReceiveQuoteCache = useCashuReceiveQuoteCache();
  const cashuSendSwapCache = useCashuSendSwapCache();
  const contactsCache = useContactsCache();
  const sparkReceiveQuoteCache = useSparkReceiveQuoteCache();
  const userCache = useUserCache();

  const handlers = {
    ...accountChangeHandlers,
    ...transactionChangeHandlers,
    ...cashuReceiveQuoteChangeHandlers,
    ...cashuSendSwapChangeHandlers,
    ...contactChangeHandlers,
    ...sparkReceiveQuoteChangeHandlers,
    ...userChangeHandlers,
  } satisfies WalletChangeHandlers<Exclude<FeedEvent, SagaOnlyEvent>>;
  const handlersRef = useLatest(handlers);
  const onConnectedRef = useLatest(() => {
    // Makes sure that data is refetched to get the latest updates from the database.
    // This handles possibly missed updates while the realtime was not connected yet
    // or while it was reconnecting.
    accountsCache.invalidate();
    transactionsCache.invalidate();
    cashuReceiveQuoteCache.invalidate();
    cashuSendSwapCache.invalidate();
    contactsCache.invalidate();
    sparkReceiveQuoteCache.invalidate();
    userCache.invalidate();
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const events = Object.keys(
      handlersRef.current,
    ) as (keyof typeof handlers)[];
    const unsubscribes = events.map((event) =>
      sdk.events.on(event, (payload) =>
        (handlersRef.current[event] as (p: typeof payload) => void)(payload),
      ),
    );
    unsubscribes.push(
      sdk.events.on('connection.changed', ({ state }) => {
        if (state === 'connected') onConnectedRef.current();
        if (state === 'error') setFailed(true);
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, []);

  if (failed) {
    throw new SupabaseRealtimeError('Realtime channel error');
  }
};
