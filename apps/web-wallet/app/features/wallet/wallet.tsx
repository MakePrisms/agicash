import * as Sentry from '@sentry/react-router';
import { type PropsWithChildren, useEffect } from 'react';
import { useSupabaseRealtimeActivityTracking } from '~/lib/supabase';
import { agicashRealtimeClient } from '../agicash-db/database.client';
import { useTrackAndUpdateSparkAccountBalances } from '../shared/spark';
import { useTheme } from '../theme';
import { useUser } from '../user/user-hooks';
import { TaskProcessor, useTakeTaskProcessingLead } from './task-processing';
import { useTrackWalletChanges } from './use-track-wallet-changes';

/**
 * Syncs the theme settings stored in cookies to match the default currency
 * according to the Agicash database.
 */
const useSyncThemeWithDefaultCurrency = () => {
  const { setTheme } = useTheme();
  const defaultCurrency = useUser((user) => user.defaultCurrency);
  useEffect(() => {
    const theme = defaultCurrency === 'BTC' ? 'btc' : 'usd';
    setTheme(theme);
  }, [defaultCurrency, setTheme]);
};

export const Wallet = ({ children }: PropsWithChildren) => {
  const user = useUser();

  useEffect(() => {
    Sentry.setUser({
      id: user.id,
      username: user.username,
      isGuest: user.isGuest,
      defaultCurrency: user.defaultCurrency,
    });
    // No cleanup — unmounting Wallet doesn't mean the user logged out.
    // Logout handles clearing Sentry user on actual logout.
  }, [user]);

  // Session-expiry host effect moves here in BW-T5 (sdk.on('auth:session-expired',...)).

  useSyncThemeWithDefaultCurrency();

  useTrackWalletChanges();
  useSupabaseRealtimeActivityTracking(agicashRealtimeClient);
  useTrackAndUpdateSparkAccountBalances();

  const isLead = useTakeTaskProcessingLead();

  return (
    <>
      {isLead && <TaskProcessor />}
      {children}
    </>
  );
};
