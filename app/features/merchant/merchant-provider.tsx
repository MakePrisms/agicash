import {
  type PropsWithChildren,
  createContext,
  useContext,
  useState,
} from 'react';
import { useStore } from 'zustand';
import type { Account } from '~/features/accounts/account';
import {
  useAccountsCache,
  useGetLatestAccount,
} from '../accounts/account-hooks';
import { useGetCashuSendSwapQuote } from '../send/cashu-send-swap-hooks';
import {
  type MerchantState,
  type MerchantStore,
  createMerchantStore,
} from './merchant-store';

const MerchantContext = createContext<MerchantStore | null>(null);

type Props = PropsWithChildren<{
  /** Usually the user's default account. This sets the initial account to send from. */
  initialAccount: Account;
}>;

export const MerchantProvider = ({ initialAccount, children }: Props) => {
  const accountsCache = useAccountsCache();
  const getLatestAccount = useGetLatestAccount();
  const { mutateAsync: getCashuSendSwapQuote } = useGetCashuSendSwapQuote();

  const [store] = useState(() =>
    createMerchantStore({
      initialAccount,
      accountsCache,
      getLatestAccount,
      getCashuSendSwapQuote,
    }),
  );

  return (
    <MerchantContext.Provider value={store}>
      {children}
    </MerchantContext.Provider>
  );
};

export const useMerchantStore = <T = MerchantState>(
  selector?: (state: MerchantState) => T,
): T => {
  const store = useContext(MerchantContext);
  if (!store) {
    throw new Error('Missing MerchantProvider in the tree');
  }
  return useStore(store, selector ?? ((state) => state as T));
};
