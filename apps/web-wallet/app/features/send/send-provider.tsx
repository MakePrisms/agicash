import {
  type PropsWithChildren,
  createContext,
  useContext,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import type { Account } from '~/features/accounts/account';
import { useAccounts, useGetAccount } from '../accounts/account-hooks';
import { GIFT_CARDS } from '../gift-cards/use-discover-cards';
import { useCreateCashuLightningSendQuote } from './cashu-send-quote-hooks';
import { useCreateCashuSendSwapQuote } from './cashu-send-swap-hooks';
import type { SendDestination } from './resolve-destination';
import { type SendState, type SendStore, createSendStore } from './send-store';
import { useCreateSparkLightningSendQuote } from './spark-send-quote-hooks';
import { useGetInvoiceFromLud16 } from './use-get-invoice-from-lud16';

const SendContext = createContext<SendStore | null>(null);

type Props = PropsWithChildren<{
  /** Usually the user's default account. This sets the initial account to send from. */
  initialAccount: Account;
  /** Initial destination to send to, if any. */
  initialDestination: SendDestination | null;
}>;

export const SendProvider = ({
  initialAccount,
  initialDestination,
  children,
}: Props) => {
  const { mutateAsync: getInvoiceFromLud16 } = useGetInvoiceFromLud16();
  const { mutateAsync: getCashuLightningQuote } =
    useCreateCashuLightningSendQuote();
  const { mutateAsync: getCashuSwapQuote } = useCreateCashuSendSwapQuote();
  const { mutateAsync: getSparkLightningQuote } =
    useCreateSparkLightningSendQuote();
  const getAccount = useGetAccount();
  // Keep a stable ref to the latest accounts list so getAccounts() always
  // returns the current snapshot without capturing a stale closure.
  const accounts = useAccounts();
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const getAccounts = useRef(() => accountsRef.current as Account[]).current;

  const [store] = useState(() =>
    createSendStore({
      initialAccount,
      initialDestination,
      getAccount,
      getAccounts,
      giftCards: GIFT_CARDS,
      getInvoiceFromLud16,
      getCashuLightningQuote,
      getCashuSwapQuote,
      getSparkLightningQuote,
    }),
  );

  return <SendContext.Provider value={store}>{children}</SendContext.Provider>;
};

export const useSendStore = <T = SendState>(
  selector?: (state: SendState) => T,
): T => {
  const store = useContext(SendContext);
  if (!store) {
    throw new Error('Missing SendProvider in the tree');
  }
  return useStore(store, selector ?? ((state) => state as T));
};
