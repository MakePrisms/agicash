import {
  type PropsWithChildren,
  createContext,
  useContext,
  useState,
} from 'react';
import { useStore } from 'zustand';
import type { Account } from '../accounts/account';
import { useGetAccount } from '../accounts/account-hooks';
import { useCreateTransferQuote } from './transfer-hooks';
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
  const { mutateAsync: createTransferQuote } = useCreateTransferQuote();

  const [store] = useState(() =>
    createTransferStore({
      sourceAccount,
      destinationAccount,
      getAccount,
      createTransferQuote,
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
