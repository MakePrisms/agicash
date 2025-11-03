import {
  type PropsWithChildren,
  createContext,
  useContext,
  useState,
} from 'react';
import { useStore } from 'zustand';
import type { ExtendedAccount } from '../accounts/account';
import type { ReceiveState, ReceiveStore } from './receive-store';
import { createReceiveStore } from './receive-store';

const ReceiveContext = createContext<ReceiveStore | null>(null);

type Props = PropsWithChildren<{
  /** Usually the user's default account. This sets the initial account to receive to. */
  initialAccount: ExtendedAccount;
}>;

export const ReceiveProvider = ({ children, initialAccount }: Props) => {
  const [store] = useState(() =>
    createReceiveStore({
      initialAccount,
      initialAmount: null,
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
