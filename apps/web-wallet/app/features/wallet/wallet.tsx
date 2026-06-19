import * as Sentry from '@sentry/react-router';
import { type PropsWithChildren, useEffect } from 'react';
import { useToast } from '~/hooks/use-toast';
import { useSupabaseRealtimeActivityTracking } from '~/lib/supabase';
import { useSdk } from '../shared/sdk';
import { useTheme } from '../theme';
import { useHandleSessionExpiry } from '../user/auth';
import { useUser } from '../user/user-hooks';
import { useSurfaceRealtimeError } from './use-surface-realtime-error';

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
  const { toast } = useToast();
  const user = useUser();
  const sdk = useSdk();

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
    onLogout: () => {
      toast({
        title: 'Session expired',
        description:
          'The session has expired. You will be redirected to the login page.',
      });
    },
  });

  useSyncThemeWithDefaultCurrency();

  useSurfaceRealtimeError();
  useSupabaseRealtimeActivityTracking(sdk.realtime);

  // Start the SDK's background engines (realtime channel, task processing,
  // spark balance tracking) for the authenticated app's lifetime.
  useEffect(() => sdk.start(), [sdk]);

  return <>{children}</>;
};
