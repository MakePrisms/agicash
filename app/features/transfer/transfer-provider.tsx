import type { Account } from '@agicash/sdk/features/accounts/account';
import {
  type PropsWithChildren,
  createContext,
  useContext,
  useState,
} from 'react';
import { useStore } from 'zustand';
import { useGetAccount } from '../accounts/account-hooks';
import { useGetTransferQuote } from './transfer-hooks';
import type { TransferState, TransferStore } from './transfer-store';
import { createTransferStore } from './transfer-store';

const TransferContext = createContext<TransferStore | null>(null);

type Props = PropsWithChildren<{
  sourceAccount: Account;
  destinationAccount: Account;
}>;

export const TransferProvider = ({
  children,
  sourceAccount,
  destinationAccount,
}: Props) => {
  const getAccount = useGetAccount();
  const { mutateAsync: getTransferQuote } = useGetTransferQuote();

  const [store] = useState(() =>
    createTransferStore({
      sourceAccount,
      destinationAccount,
      getAccount,
      getTransferQuote,
    }),
  );

  return (
    <TransferContext.Provider value={store}>
      {children}
    </TransferContext.Provider>
  );
};

export const useTransferStore = <T,>(
  selector: (state: TransferState) => T,
): T => {
  const store = useContext(TransferContext);
  if (!store) {
    throw new Error('Missing TransferProvider in the tree');
  }
  return useStore(store, selector);
};
