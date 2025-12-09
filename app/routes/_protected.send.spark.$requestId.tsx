import {
  ClosePageButton,
  Page,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { useAccounts } from '~/features/accounts/account-hooks';
import { useTrackSparkSendQuote } from '~/features/send/spark-send-quote-hooks';
import { TransactionDetails } from '~/features/transactions/transaction-details';
import { useUser } from '~/features/user/user-hooks';
import type { Route } from './+types/_protected.send.spark.$requestId';

export default function SendSparkPage({ params }: Route.ComponentProps) {
  const { requestId } = params;

  const userId = useUser((user) => user.id);
  const { data: sparkAccounts } = useAccounts({ type: 'spark' });
  const account = sparkAccounts[0];

  const { request } = useTrackSparkSendQuote({
    requestId,
  });

  return (
    <Page>
      <PageHeader>
        <ClosePageButton to="/" transition="slideDown" applyTo="oldView" />
        <PageHeaderTitle>Send</PageHeaderTitle>
      </PageHeader>
      {/* TODO: I just did this for now until we have spark transactions */}
      <TransactionDetails
        transaction={{
          id: requestId,
          userId,
          accountId: account.id,
          amount: request.amount,
          state: request.state,
          createdAt: request.createdAt,
          direction: 'SEND',
          type: 'SPARK_LIGHTNING',
          details: {},
          acknowledgmentStatus: null,
        }}
        defaultShowOkayButton={true}
      />
    </Page>
  );
}
