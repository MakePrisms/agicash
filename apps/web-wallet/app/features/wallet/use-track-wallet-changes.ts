import { useEffect } from 'react';
import { getSdk } from '~/lib/sdk';
import {
  useAccountsCache,
  useWireAccountEvents,
} from '../accounts/account-hooks';
import {
  useContactsCache,
  useWireContactEvents,
} from '../contacts/contact-hooks';
import {
  useCashuReceiveQuoteCache,
  usePendingCashuReceiveQuotesCache,
  useWireCashuReceiveQuoteEvents,
} from '../receive/cashu-receive-quote-hooks';
import {
  usePendingCashuReceiveSwapsCache,
  useWireCashuReceiveSwapEvents,
} from '../receive/cashu-receive-swap-hooks';
import {
  usePendingSparkReceiveQuotesCache,
  useSparkReceiveQuoteCache,
  useWireSparkReceiveQuoteEvents,
} from '../receive/spark-receive-quote-hooks';
import {
  useUnresolvedCashuSendQuotesCache,
  useWireCashuSendQuoteEvents,
} from '../send/cashu-send-quote-hooks';
import {
  useCashuSendSwapCache,
  useUnresolvedCashuSendSwapsCache,
  useWireCashuSendSwapEvents,
} from '../send/cashu-send-swap-hooks';
import {
  useUnresolvedSparkSendQuotesCache,
  useWireSparkSendQuoteEvents,
} from '../send/spark-send-quote-hooks';
import {
  useTransactionsCache,
  useWireTransactionEvents,
} from '../transactions/transaction-hooks';
import { useUserCache, useWireUserEvents } from '../user/user-hooks';

/**
 * Subscribes every feature's cache to the SDK's decrypted-entity events and
 * refreshes all caches on `connection:resync`. Replaces the former single
 * Supabase broadcast channel.
 */
export const useWalletEvents = () => {
  useWireAccountEvents();
  useWireTransactionEvents();
  useWireCashuReceiveQuoteEvents();
  useWireCashuReceiveSwapEvents();
  useWireCashuSendQuoteEvents();
  useWireCashuSendSwapEvents();
  useWireContactEvents();
  useWireSparkReceiveQuoteEvents();
  useWireSparkSendQuoteEvents();
  useWireUserEvents();

  const accountsCache = useAccountsCache();
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
  const userCache = useUserCache();

  useEffect(() => {
    const sdk = getSdk();
    // Refetch everything to catch up on changes missed while the connection was
    // down or reconnecting (the old broadcast channel's `onConnected`).
    return sdk.on('connection:resync', () => {
      accountsCache.invalidate();
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
      userCache.invalidate();
    });
  }, [
    accountsCache,
    transactionsCache,
    cashuReceiveQuoteCache,
    pendingCashuReceiveQuotesCache,
    pendingCashuReceiveSwapsCache,
    unresolvedCashuSendQuotesCache,
    cashuSendSwapCache,
    unresolvedCashuSendSwapsCache,
    contactsCache,
    sparkReceiveQuoteCache,
    pendingSparkReceiveQuotesCache,
    unresolvedSparkSendQuotesCache,
    userCache,
  ]);
};
