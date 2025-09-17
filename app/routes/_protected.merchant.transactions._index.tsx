import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { TransactionList } from '~/features/transactions/transaction-list';

export default function MerchantGiftsListPage() {
  return (
    <Page>
      <PageHeader>
        <ClosePageButton
          to="/merchant"
          transition="slideRight"
          applyTo="oldView"
        />
        <PageHeaderTitle>Gifts</PageHeaderTitle>
      </PageHeader>
      <PageContent className="overflow-hidden">
        <TransactionList types={['GIFT']} />
      </PageContent>
    </Page>
  );
}
