import {
  ClosePageButton,
  Page,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { TransactionDetails } from '~/features/transactions/transaction-details';
import { useSuspenseTransaction } from '~/features/transactions/transaction-hooks';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import type { Route } from './+types/_protected.transactions.$transactionId_';

export default function TransactionDetailsPage({
  params: { transactionId },
}: Route.ComponentProps) {
  const { data: transaction } = useSuspenseTransaction(transactionId);
  const { redirectTo } = useRedirectTo('/transactions');

  return (
    <Page>
      <PageHeader className="z-10">
        <ClosePageButton
          to={redirectTo}
          transition="slideDown"
          applyTo="oldView"
        />
        <PageHeaderTitle>
          {transaction.state === 'REVERSED'
            ? 'Reclaimed'
            : transaction.direction === 'RECEIVE'
              ? 'Received'
              : 'Sent'}
        </PageHeaderTitle>
      </PageHeader>
      <TransactionDetails transaction={transaction} redirectTo={redirectTo} />
    </Page>
  );
}
