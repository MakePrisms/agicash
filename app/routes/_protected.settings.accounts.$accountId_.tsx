import { useParams } from 'react-router';
import { Page } from '~/components/page';
import SingleAccount from '~/features/settings/accounts/single-account';

export default function SingleAccountPage() {
  const { accountId } = useParams();

  if (!accountId) {
    throw new Error('Account ID is required');
  }

  return (
    <Page>
      <SingleAccount accountId={accountId} />
    </Page>
  );
}
