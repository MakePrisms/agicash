import * as Sentry from '@sentry/react-router';
import { type PropsWithChildren, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '~/hooks/use-toast';
import { useSupabaseRealtimeActivityTracking } from '~/lib/supabase';
import { agicashRealtimeClient } from '../agicash-db/database.client';
import { getPendingCashAppBuy } from '../buy/pending-cashapp-buy';
import { useTrackAndUpdateSparkAccountBalances } from '../shared/spark';
import { useTheme } from '../theme';
import { useHandleSessionExpiry } from '../user/auth';
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

const usePendingCashAppBuyRedirect = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const checkAndRedirect = () => {
      const pending = getPendingCashAppBuy();
      if (pending && !window.location.pathname.startsWith('/buy/checkout')) {
        navigate('/buy/checkout');
      }
    };

    checkAndRedirect();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAndRedirect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [navigate]);
};

export const Wallet = ({ children }: PropsWithChildren) => {
  const { toast } = useToast();
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

  useHandleSessionExpiry({
    isGuestAccount: user.isGuest,
    onLogout: () => {
      toast({
        title: 'Session expired',
        description:
          'The session has expired. You will be redirected to the login page.',
      });
    },
  });

  useSyncThemeWithDefaultCurrency();

  useTrackWalletChanges();
  useSupabaseRealtimeActivityTracking(agicashRealtimeClient);
  useTrackAndUpdateSparkAccountBalances();
  usePendingCashAppBuyRedirect();

  const isLead = useTakeTaskProcessingLead();

  return (
    <>
      {isLead && <TaskProcessor />}
      {children}
    </>
  );
};
