import { useSearchParams } from 'react-router';
import {
  ClosePageButton,
  Page,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { TransactionDetails } from '~/features/transactions/transaction-details';
import { useSuspenseTransaction } from '~/features/transactions/transaction-hooks';
import type { Route } from './+types/_protected.transactions.$transactionId_';

export default function TransactionDetailsPage({
  params: { transactionId },
}: Route.ComponentProps) {
  const { data: transaction } = useSuspenseTransaction(transactionId);
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirectTo');

  return (
    <Page>
      <PageHeader className="z-10">
        <ClosePageButton
          to={redirectTo ?? '/transactions'}
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
      <TransactionDetails
        transaction={transaction}
        defaultShowOkayButton={!!redirectTo}
      />
    </Page>
  );
}
