import { useState } from 'react';
import { Outlet, useOutletContext } from 'react-router';
import { create, useStore } from 'zustand';
import type { Transaction } from '~/features/transactions/transaction';

type TransactionAckStatusState = {
  statuses: Map<string, Transaction['acknowledgmentStatus']>;
  setIfMissing: (transaction: Transaction) => void;
  setAckStatus: (transaction: Transaction) => void;
};

const createTransactionAckStatusStore = () => {
  return create<TransactionAckStatusState>((set, get) => ({
    statuses: new Map(),
    setIfMissing: (transaction: Transaction) => {
      const { statuses, setAckStatus } = get();
      if (statuses.has(transaction.id)) {
        return;
      }
      setAckStatus(transaction);
    },
    setAckStatus: (transaction: Transaction) => {
      const { statuses } = get();
      set({
        statuses: new Map(statuses).set(
          transaction.id,
          transaction.acknowledgmentStatus,
        ),
      });
    },
  }));
};

type TransactionAckStatusStore = ReturnType<
  typeof createTransactionAckStatusStore
>;

export function useTransactionAckStatusStore() {
  const store = useOutletContext<TransactionAckStatusStore>();
  if (!store) {
    throw new Error(
      'TransactionAckStatusStore not found in router outlet context',
    );
  }
  return useStore(store);
}

export default function TransactionsLayout() {
  const [store] = useState(() => createTransactionAckStatusStore());

  return <Outlet context={store} />;
}
