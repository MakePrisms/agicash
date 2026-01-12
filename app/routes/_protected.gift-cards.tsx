import { useState } from 'react';
import { Outlet } from 'react-router';
import { createTransactionAckStatusStore } from '~/features/transactions/transaction-ack-status-store';
import '~/features/gift-cards/transitions.css';

export default function GiftCardsLayout() {
  const [store] = useState(() => createTransactionAckStatusStore());

  return <Outlet context={store} />;
}
