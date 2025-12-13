import {
  type PropsWithChildren,
  createContext,
  useContext,
  useState,
} from 'react';
import { useStore } from 'zustand';
import type { Account } from '~/features/accounts/account';
import { useGetAccount } from '../accounts/account-hooks';
import { useCreateCashuLightningSendQuote } from './cashu-send-quote-hooks';
import { useCreateCashuSendSwapQuote } from './cashu-send-swap-hooks';
import { type SendState, type SendStore, createSendStore } from './send-store';
import { useCreateSparkLightningSendQuote } from './spark-send-quote-hooks';
import { useGetInvoiceFromLud16 } from './use-get-invoice-from-lud16';

const SendContext = createContext<SendStore | null>(null);

type Props = PropsWithChildren<{
  /** Usually the user's default account. This sets the initial account to send from. */
  initialAccount: Account;
}>;

export const SendProvider = ({ initialAccount, children }: Props) => {
  const { mutateAsync: getInvoiceFromLud16 } = useGetInvoiceFromLud16();
  const { mutateAsync: getCashuLightningQuote } =
    useCreateCashuLightningSendQuote();
  const { mutateAsync: getCashuSwapQuote } = useCreateCashuSendSwapQuote();
  const { mutateAsync: getSparkLightningQuote } =
    useCreateSparkLightningSendQuote();
  const getAccount = useGetAccount();

  const [store] = useState(() =>
    createSendStore({
      initialAccount,
      getAccount,
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
