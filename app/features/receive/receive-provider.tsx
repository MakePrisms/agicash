import {
  type PropsWithChildren,
  createContext,
  useContext,
  useState,
} from 'react';
import { useStore } from 'zustand';
import type { Account } from '../accounts/account';
import { useGetAccount } from '../accounts/account-hooks';
import { useCreateCashuReceiveQuote } from './cashu-receive-quote-hooks';
import type { ReceiveState, ReceiveStore } from './receive-store';
import { createReceiveStore } from './receive-store';
import { useCreateSparkReceiveQuote } from './spark-receive-quote-hooks';

const ReceiveContext = createContext<ReceiveStore | null>(null);

type Props = PropsWithChildren<{
  /** Usually the user's default account. This sets the initial account to receive to. */
  initialAccount: Account;
}>;

export const ReceiveProvider = ({ children, initialAccount }: Props) => {
  const getAccount = useGetAccount();
  const { mutateAsync: createCashuReceiveQuote } = useCreateCashuReceiveQuote();
  const { mutateAsync: createSparkReceiveQuote } = useCreateSparkReceiveQuote();

  const [store] = useState(() =>
    createReceiveStore({
      initialAccount,
      initialAmount: null,
      getAccount,
      createCashuReceiveQuote,
      createSparkReceiveQuote,
    }),
  );

  return (
    <ReceiveContext.Provider value={store}>{children}</ReceiveContext.Provider>
  );
};

export const useReceiveStore = <T,>(
  selector: (state: ReceiveState) => T,
): T => {
  const store = useContext(ReceiveContext);
  if (!store) {
    throw new Error('Missing ReceiveProvider in the tree');
  }
  return useStore(store, selector);
};
