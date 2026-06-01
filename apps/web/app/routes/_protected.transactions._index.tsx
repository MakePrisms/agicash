import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { TransactionList } from '~/features/transactions/transaction-list';

export default function TransactionsPage() {
  return (
    <Page>
      <PageHeader>
        <ClosePageButton to="/" transition="slideRight" applyTo="oldView" />
        <PageHeaderTitle>Transactions</PageHeaderTitle>
      </PageHeader>
      <PageContent className="overflow-hidden">
        <TransactionList />
      </PageContent>
    </Page>
  );
}
