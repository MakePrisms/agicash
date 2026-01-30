import { useParams } from 'react-router';
import { Page } from '~/components/page';
import AccountProofs from '~/features/settings/accounts/account-proofs';

export default function AccountProofsPage() {
  const { accountId } = useParams();

  if (!accountId) {
    throw new Error('Account ID is required');
  }

  return (
    <Page>
      <AccountProofs accountId={accountId} />
    </Page>
  );
}
