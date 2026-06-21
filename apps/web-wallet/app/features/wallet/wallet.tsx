import * as Sentry from '@sentry/react-router';
import { type PropsWithChildren, useEffect } from 'react';
import { useToast } from '~/hooks/use-toast';
import { getSdk } from '~/lib/sdk';
import { useTrackAndUpdateSparkAccountBalances } from '../shared/spark';
import { useTheme } from '../theme';
import { useAuthActions } from '../user/auth';
import { useUser } from '../user/user-hooks';
import { useSDKActivityTracking } from './use-sdk-activity-tracking';
import { useTrackWalletChanges } from './use-track-wallet-changes';
import { useTransactionLifecycleSync } from './use-transaction-lifecycle-sync';

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
  const { toast } = useToast();
  const { signOut } = useAuthActions();

  // initSdk() resolved in the _protected middleware before this layout renders.
  const sdk = getSdk();
  // background is `?:` on the base Sdk type but always present on the store
  // engine (injected at construction).
  const background = sdk.background;
  if (!background) {
    throw new Error('SDK background domain is not available');
  }

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

  useEffect(() => {
    background.start().catch((error) => {
      console.error('Failed to start background processing', { cause: error });
    });
    return () => {
      void background.stop();
    };
  }, [background]);

  useSDKActivityTracking(background);

  useEffect(() => {
    return sdk.on('auth:session-expired', () => {
      toast({
        title: 'Session expired',
        description:
          'The session has expired. You will be redirected to the login page.',
      });
      void signOut({ redirectTo: '/home' });
    });
  }, [sdk, toast, signOut]);

  useEffect(() => {
    const resync = () => {
      sdk.resync().catch((error) => {
        console.error('Failed to resync', { cause: error });
      });
    };
    window.addEventListener('focus', resync);
    window.addEventListener('online', resync);
    return () => {
      window.removeEventListener('focus', resync);
      window.removeEventListener('online', resync);
    };
  }, [sdk]);

  useSyncThemeWithDefaultCurrency();

  useTrackWalletChanges();
  useTransactionLifecycleSync();
  useTrackAndUpdateSparkAccountBalances();

  return <>{children}</>;
};
