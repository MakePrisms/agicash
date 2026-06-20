import * as Sentry from '@sentry/react-router';
import { type PropsWithChildren, useEffect } from 'react';
import { useSdk } from '../shared/use-sdk';
import { useTheme } from '../theme';
import { useUser } from '../user/user-hooks';
import { useRealtimeConnectivity } from './use-realtime-connectivity';
import { useSdkEventBridge } from './use-sdk-event-bridge';

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
  const sdkPromise = useSdk();

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

  useSyncThemeWithDefaultCurrency();

  useSdkEventBridge();
  useRealtimeConnectivity();

  // start() parks in 'starting' if there is no session and does not auto-recover,
  // so re-issue stop()->start() keyed on the authed user.
  // biome-ignore lint/correctness/useExhaustiveDependencies: user.id is a deliberate re-run key (re-elect the leader on user change), not read in the body
  useEffect(() => {
    let sdkRef: Awaited<typeof sdkPromise> | undefined;
    void sdkPromise.then((sdk) => {
      sdkRef = sdk;
      sdk.background.start();
    });
    return () => {
      sdkRef?.background.stop();
    };
  }, [sdkPromise, user.id]);

  return <>{children}</>;
};
