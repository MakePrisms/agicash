import { TransactionAdditionalDetails } from '~/features/transactions/transaction-additional-details';
import type { Route } from './+types/_protected.transactions.$transactionId.details';

export default function TransactionDetailsPage({
  params: { transactionId },
}: Route.ComponentProps) {
  return <TransactionAdditionalDetails transactionId={transactionId} />;
}
