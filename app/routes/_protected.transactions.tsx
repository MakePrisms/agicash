import { Outlet } from 'react-router';
import { useTransactions } from '~/features/transactions/transaction-hooks';

export type TransactionsLayoutContext = ReturnType<typeof useTransactions>;

export default function TransactionsLayout() {
  const transactionsQuery = useTransactions();

  return <Outlet context={transactionsQuery} />;
}
