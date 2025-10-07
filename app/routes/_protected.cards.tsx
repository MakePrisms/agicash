import { useState } from 'react';
import { Outlet } from 'react-router';
import { createTransactionAckStatusStore } from '~/features/transactions/transaction-ack-status-store';

export default function CardsLayout() {
  const [store] = useState(() => createTransactionAckStatusStore());

  return <Outlet context={store} />;
}
