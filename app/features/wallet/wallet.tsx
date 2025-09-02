import * as Sentry from '@sentry/react-router';
import { type PropsWithChildren, useEffect } from 'react';
import { useToast } from '~/hooks/use-toast';
import { useTrackAccounts } from '../accounts/account-hooks';
import { useTrackPendingCashuReceiveQuotes } from '../receive/cashu-receive-quote-hooks';
import { useTrackPendingCashuTokenSwaps } from '../receive/cashu-token-swap-hooks';
import { useTrackUnresolvedCashuSendQuotes } from '../send/cashu-send-quote-hooks';
import { useTrackUnresolvedCashuSendSwaps } from '../send/cashu-send-swap-hooks';
import { useTheme } from '../theme';
import { useTrackTransactions } from '../transactions/transaction-hooks';
import { useHandleSessionExpiry } from '../user/auth';
import { useUser } from '../user/user-hooks';
import { TaskProcessor, useTakeTaskProcessingLead } from './task-processing';

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

  useEffect(() => {
    Sentry.setUser({
      id: user.id,
      username: user.username,
      isGuest: user.isGuest,
      defaultCurrency: user.defaultCurrency,
    });

    return () => {
      Sentry.setUser(null);
    };
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

  const isLead = useTakeTaskProcessingLead();

  useTrackAccounts();
  useTrackTransactions();
  useTrackPendingCashuReceiveQuotes();
  useTrackPendingCashuTokenSwaps();
  useTrackUnresolvedCashuSendQuotes();
  useTrackUnresolvedCashuSendSwaps();

  return (
    <>
      {isLead && <TaskProcessor />}
      {children}
    </>
  );
};
